"""Vues de l'inscription payante. La logique vit dans `services.py` (CLAUDE.md §7).

Deux familles nettement séparées :

- l'étudiant ne parle jamais que de **sa** propre inscription — aucune de ses routes ne
  prend d'identifiant, il n'y a donc rien à énumérer (§4.3) ;
- l'admin prend des identifiants, et chacune de ses routes passe par `EstAdmin`, qui
  renvoie 404 à un non-admin.
"""

from __future__ import annotations

import io

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Exists, OuterRef
from django.http import FileResponse, Http404
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.throttling import TropDeTentativesError, enforce_rate_limit
from apps.accounts.utils import get_client_ip
from apps.enrollment import services
from apps.enrollment.files import (
    TAILLE_MAX_OCTETS,
    FichierRefuseError,
    FichierTropVolumineuxError,
)
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.permissions import EstAdmin
from apps.enrollment.serializers import (
    AcceptSerializer,
    AdminEnrollmentSerializer,
    EnrollmentStatusSerializer,
    ProofUploadSerializer,
    ProofUrlSerializer,
    RejectSerializer,
)

MESSAGE_TROP_DE_TENTATIVES = "Trop de tentatives. Réessaie plus tard."


class EnrollmentStatusView(APIView):
    """État de l'inscription du compte courant, et instructions de versement."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        etat = services.etat_inscription(request.user)
        return Response(EnrollmentStatusSerializer(etat).data)


class PaymentProofUploadView(APIView):
    """Dépôt du reçu. Tout le pipeline §4.5 est dans `services.deposer_preuve`."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request: Request) -> Response:
        assert isinstance(request.user, User)

        # Refus au plus tôt : sans ce contrôle, un corps de 100 Mo serait entièrement
        # reçu et écrit dans un fichier temporaire avant d'être rejeté.
        declaree = request.META.get("CONTENT_LENGTH") or "0"
        try:
            if int(declaree) > TAILLE_MAX_OCTETS + 8192:
                return Response({"detail": "Le fichier dépasse 5 Mo."}, status=413)
        except ValueError:
            return Response({"detail": "Requête invalide."}, status=400)

        try:
            enforce_rate_limit(
                "proof:user", str(request.user.pk), max_attempts=10, window_seconds=3600
            )
            enforce_rate_limit(
                "proof:ip", get_client_ip(request), max_attempts=20, window_seconds=3600
            )
        except TropDeTentativesError:
            return Response({"detail": MESSAGE_TROP_DE_TENTATIVES}, status=429)

        serializer = ProofUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        fichier = serializer.validated_data["file"]
        contenu: bytes = fichier.read()

        try:
            preuve = services.deposer_preuve(
                user=request.user,
                contenu=contenu,
                amount_declared=serializer.validated_data["amount_declared"],
            )
        except FichierTropVolumineuxError as exc:
            return Response({"detail": str(exc)}, status=413)
        except FichierRefuseError as exc:
            return Response({"detail": str(exc)}, status=400)
        except services.DepotImpossibleError as exc:
            return Response({"detail": str(exc)}, status=409)

        return Response({"id": str(preuve.pk), "status": preuve.status}, status=201)


class AdminEnrollmentListView(APIView):
    """File d'attente de l'admin. Filtre par statut, aucun contenu de fichier ici."""

    permission_classes = [EstAdmin]

    def get(self, request: Request) -> Response:
        preuve_en_examen = PaymentProof.objects.filter(
            enrollment_id=OuterRef("pk"), status=PaymentProof.Status.SUBMITTED
        )
        queryset = (
            Enrollment.objects.select_related("user", "course")
            .prefetch_related("payment_proofs")
            .annotate(a_preuve_en_examen=Exists(preuve_en_examen))
            .order_by("-a_preuve_en_examen", "-created_at")
        )

        statut = request.query_params.get("status")
        if statut:
            # Allow-list stricte : la valeur ne touche jamais un `filter()` sans être
            # comparée aux choix du modèle (§4.3, point 8 de la checklist).
            if statut not in Enrollment.Status.values:
                return Response({"detail": "Statut inconnu."}, status=400)
            queryset = queryset.filter(status=statut)

        return Response(AdminEnrollmentSerializer(queryset[:200], many=True).data)


class AdminEnrollmentAcceptView(APIView):
    permission_classes = [EstAdmin]

    def post(self, request: Request, enrollment_id: int) -> Response:
        assert isinstance(request.user, User)
        serializer = AcceptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            inscription = services.accepter_inscription(
                admin=request.user,
                enrollment_id=enrollment_id,
                note=serializer.validated_data.get("note", ""),
            )
        except services.InscriptionIntrouvableError:
            raise Http404 from None
        except services.TransitionImpossibleError as exc:
            return Response({"detail": str(exc)}, status=409)

        return Response({"id": inscription.pk, "status": inscription.status})


class AdminEnrollmentRejectView(APIView):
    permission_classes = [EstAdmin]

    def post(self, request: Request, enrollment_id: int) -> Response:
        assert isinstance(request.user, User)
        serializer = RejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            inscription = services.refuser_preuve(
                admin=request.user,
                enrollment_id=enrollment_id,
                motif=serializer.validated_data["reason"],
            )
        except services.InscriptionIntrouvableError:
            raise Http404 from None
        except services.TransitionImpossibleError as exc:
            return Response({"detail": str(exc)}, status=409)

        return Response({"id": inscription.pk, "status": inscription.status})


class AdminProofUrlView(APIView):
    """Émet l'URL signée TTL 10 min et journalise la consultation (§4.5)."""

    permission_classes = [EstAdmin]

    def get(self, request: Request, proof_id: str) -> Response:
        assert isinstance(request.user, User)
        try:
            url = services.emettre_url_preuve(admin=request.user, proof_id=proof_id)
        except (services.PreuveIndisponibleError, ValueError, DjangoValidationError):
            # `ValidationError` : un `proof_id` qui n'est pas un UUID fait lever le
            # champ UUID au moment du filtre. Même 404 qu'une preuve inexistante.
            raise Http404 from None
        return Response(ProofUrlSerializer(url).data)


class AdminProofFileView(APIView):
    """Sert le fichier déchiffré. Signature **et** session admin exigées, jamais l'une seule."""

    permission_classes = [EstAdmin]

    def get(self, request: Request, proof_id: str) -> FileResponse:
        assert isinstance(request.user, User)

        # La signature et l'expiration voyagent en en-tête, jamais en query string :
        # un GET recopié depuis un access log n'a plus rien d'utilisable (§4.6).
        try:
            expires = int(request.headers.get("X-Proof-Expires") or "")
        except ValueError:
            raise Http404 from None
        signature = request.headers.get("X-Proof-Signature") or ""

        try:
            preuve = services.ouvrir_preuve(
                admin=request.user,
                proof_id=proof_id,
                expires=expires,
                signature=signature,
            )
        except (services.PreuveIndisponibleError, ValueError, DjangoValidationError):
            raise Http404 from None

        reponse = FileResponse(
            io.BytesIO(preuve.contenu),
            content_type=preuve.content_type,
            # Jamais en ligne : un PDF affiché dans l'onglet s'exécute dans l'origine
            # du site. En pièce jointe, il ne fait rien tout seul (§4.5).
            as_attachment=True,
            filename=f"preuve-{proof_id}",
        )
        reponse["X-Content-Type-Options"] = "nosniff"
        reponse["Cache-Control"] = "no-store, private"
        reponse["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return reponse

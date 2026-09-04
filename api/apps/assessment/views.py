"""Vues des QCM et examens. Deny by default (§4.3) : tout est `IsAuthenticated`.

Un quiz ou une tentative inaccessible renvoie 404, jamais 403 (§4.3, §4.4) : ni le
paywall sur un QCM payant, ni la tentative d'un autre étudiant ne doivent se
distinguer d'une ressource qui n'existe pas.
"""

from __future__ import annotations

from django.db.models import Prefetch
from django.http import Http404
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.throttling import TropDeTentativesError, enforce_rate_limit
from apps.assessment import services
from apps.assessment.models import Choice, Question, Quiz
from apps.assessment.serializers import (
    AttemptStartSerializer,
    EtatQuizSerializer,
    ResultatTentativeSerializer,
    SubmitRequestSerializer,
)

MESSAGE_TROP_DE_TENTATIVES = "Trop de tentatives. Réessaie plus tard."


def _quiz_ou_404(quiz_id: int) -> Quiz:
    try:
        return (
            Quiz.objects.select_related(
                "chapter__module__course",
                "module__course",
            )
            .prefetch_related(
                Prefetch(
                    "questions",
                    queryset=Question.objects.prefetch_related(
                        Prefetch("choices", queryset=Choice.objects.all())
                    ),
                )
            )
            .get(pk=quiz_id)
        )
    except Quiz.DoesNotExist:
        raise Http404 from None


class QuizDetailView(APIView):
    """GET /api/quizzes/{id} — jamais `is_correct` dans cette réponse (§4.4, §8.2)."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request, id: int) -> Response:
        assert isinstance(request.user, User)

        try:
            enforce_rate_limit(
                "quizzes:read", str(request.user.pk), max_attempts=60, window_seconds=60
            )
        except TropDeTentativesError:
            return Response({"detail": MESSAGE_TROP_DE_TENTATIVES}, status=429)

        quiz = _quiz_ou_404(id)
        if not services.a_acces_au_quiz(user=request.user, quiz=quiz):
            raise Http404

        etat = services.etat_quiz(user=request.user, quiz=quiz)
        return Response(EtatQuizSerializer(etat).data)


class QuizStartAttemptView(APIView):
    """POST /api/quizzes/{id}/attempts — démarre (ou reprend) une tentative."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, id: int) -> Response:
        assert isinstance(request.user, User)

        try:
            enforce_rate_limit(
                "quizzes:start", str(request.user.pk), max_attempts=30, window_seconds=60
            )
        except TropDeTentativesError:
            return Response({"detail": MESSAGE_TROP_DE_TENTATIVES}, status=429)

        quiz = _quiz_ou_404(id)
        if not services.a_acces_au_quiz(user=request.user, quiz=quiz):
            raise Http404

        try:
            tentative = services.demarrer_tentative(user=request.user, quiz=quiz)
        except services.TentativesEpuiseesError:
            return Response(
                {"detail": "Tu as utilisé toutes tes tentatives pour ce QCM."}, status=409
            )

        return Response(AttemptStartSerializer(tentative).data, status=201)


class AttemptSubmitView(APIView):
    """POST /api/attempts/{id}/submit — corrige et renvoie score + explications.

    `id` n'appartient jamais qu'à l'appelant : `services.soumettre_tentative` filtre
    par `(pk, user)`, donc l'attempt d'un autre étudiant est indiscernable d'un attempt
    inexistant (§8.1 — checklist IDOR).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, id: int) -> Response:
        assert isinstance(request.user, User)

        try:
            enforce_rate_limit(
                "attempts:submit", str(request.user.pk), max_attempts=30, window_seconds=60
            )
        except TropDeTentativesError:
            return Response({"detail": MESSAGE_TROP_DE_TENTATIVES}, status=429)

        serializer = SubmitRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reponses: dict[int, int] = serializer.validated_data["answers"]

        try:
            resultat = services.soumettre_tentative(
                user=request.user, attempt_id=id, reponses=reponses
            )
        except services.TentativeIntrouvableError:
            raise Http404 from None
        except services.TentativeDejaSoumiseError:
            return Response({"detail": "Cette tentative a déjà été corrigée."}, status=409)
        except services.SoumissionTropRapideError:
            return Response(
                {"detail": "Réponds un peu plus lentement avant d'envoyer."}, status=400
            )
        except services.ReponsesInvalidesError:
            return Response({"detail": "Réponses invalides pour ce QCM."}, status=400)

        return Response(ResultatTentativeSerializer(resultat).data, status=200)

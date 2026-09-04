"""Vues du catalogue public. Deny by default sauf `AllowAny` explicite (§4.3).

Toute ressource non accessible renvoie 404, jamais 403 : on ne confirme jamais
l'existence d'un chapitre payant ou d'un cours non publié (§4.3, §4.4).
"""

from __future__ import annotations

from django.http import Http404
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.throttling import TropDeTentativesError, enforce_rate_limit
from apps.accounts.utils import get_client_ip
from apps.accounts.utils import ip_prefix as compute_ip_prefix
from apps.catalog import services
from apps.catalog.models import Chapter, Course
from apps.catalog.serializers import (
    ChapterDetailSerializer,
    CoursePublicSerializer,
    LeadSerializer,
)
from apps.enrollment import services as enrollment_services


class CoursePublicDetailView(APIView):
    """Structure de la formation : titres, résumés. Jamais le contenu d'une leçon (§4.4)."""

    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def get(self, request: Request, slug: str) -> Response:
        try:
            course = Course.objects.prefetch_related("modules__chapters").get(
                slug=slug, is_published=True
            )
        except Course.DoesNotExist:
            # Pas de message d'erreur construit à partir de la requête (§4.3) : Django
            # y mettrait le slug demandé, ce qui distinguerait un cours en préparation
            # d'un cours qui n'existe pas du tout. `Http404` sans argument laisse DRF
            # renvoyer son "Not found." générique, identique dans les deux cas.
            raise Http404 from None
        return Response(CoursePublicSerializer(course).data)


class ChapterPublicDetailView(APIView):
    """Contenu complet d'un chapitre — seulement s'il est `is_free` (§4.4)."""

    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def get(self, request: Request, slug: str) -> Response:
        try:
            chapter = Chapter.objects.select_related("lesson", "module", "module__course").get(
                slug=slug
            )
        except Chapter.DoesNotExist:
            raise Http404 from None
        if not chapter.is_free or not chapter.module.course.is_published:
            # Même réponse — sans argument, donc bit pour bit identique — qu'un
            # chapitre inexistant : ne jamais confirmer qu'il existe (§4.3).
            raise Http404
        return Response(ChapterDetailSerializer(chapter).data)


class ChapterDetailView(APIView):
    """Contenu d'un chapitre pour un compte connecté.

    C'est le seul endroit où un chapitre payant peut sortir de l'API, et il ne le fait
    que pour une inscription `ACTIVE` (§4.4). Un compte `PENDING`, `BLOCKED` ou
    `EXPIRED` reçoit exactement la même 404 qu'un chapitre inexistant : ni le titre, ni
    la durée, ni l'existence du chapitre ne fuient par cette route.

    Un chapitre à la fois, jamais l'arbre complet avec les contenus (§4.4).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request, slug: str) -> Response:
        assert isinstance(request.user, User)

        try:
            chapter = Chapter.objects.select_related("lesson", "module", "module__course").get(
                slug=slug
            )
        except Chapter.DoesNotExist:
            raise Http404 from None

        if not chapter.module.course.is_published:
            raise Http404

        if not chapter.is_free and not enrollment_services.a_acces_au_contenu(request.user):
            raise Http404

        return Response(ChapterDetailSerializer(chapter).data)


class LeadCreateView(APIView):
    """Liste d'attente. Anti-bot minimal + limite de débit — pas de donnée sensible ici."""

    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request: Request) -> Response:
        serializer = LeadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ip = get_client_ip(request)
        try:
            enforce_rate_limit("leads:ip", ip, max_attempts=5, window_seconds=3600)
        except TropDeTentativesError:
            return Response({"detail": "Trop de tentatives. Réessaie plus tard."}, status=429)

        try:
            services.creer_lead(
                email=data["email"],
                phone=data.get("phone", ""),
                site=data.get("site", ""),
                form_rendered_at=data["form_rendered_at"],
                ip_prefix=compute_ip_prefix(ip),
            )
        except services.SoumissionSuspecteError:
            # Même réponse de succès qu'une vraie inscription : ne pas apprendre au
            # bot ce qui l'a fait recaler.
            pass

        return Response({"detail": "Inscrit à la liste d'attente."}, status=201)

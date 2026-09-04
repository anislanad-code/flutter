"""Vues du pipeline. Deny by default (§4.3) : tout est `IsAuthenticated`.

Aucune vue ne prend d'identifiant d'utilisateur — la progression lue et écrite est
toujours celle de `request.user` (§8 checklist IDOR : rien à énumérer ici).
"""

from __future__ import annotations

import re

from django.http import Http404
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.throttling import TropDeTentativesError, enforce_rate_limit
from apps.catalog.models import Chapter, Course
from apps.enrollment import services as enrollment_services
from apps.learning import services
from apps.learning.serializers import ChapterCompleteResponseSerializer, PipelineSerializer

MESSAGE_TROP_DE_TENTATIVES = "Trop de tentatives. Réessaie plus tard."

# Même alphabet qu'un `SlugField` Django. Rejeter ce qui ne correspond pas avant de
# toucher la base évite qu'un octet NUL ou un caractère de contrôle atteigne le pilote
# PostgreSQL, qui lève une exception non gérée (500) plutôt qu'un 404 propre.
FORME_SLUG = re.compile(r"^[-a-zA-Z0-9_]+$")


class ProgressView(APIView):
    """GET /api/progress?course=<slug> — état de chaque nœud pour le compte courant."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)

        try:
            enforce_rate_limit(
                "progress:read", str(request.user.pk), max_attempts=60, window_seconds=60
            )
        except TropDeTentativesError:
            return Response({"detail": MESSAGE_TROP_DE_TENTATIVES}, status=429)

        slug = request.query_params.get("course", "")
        if not FORME_SLUG.match(slug):
            raise Http404
        try:
            course = Course.objects.get(slug=slug, is_published=True)
        except Course.DoesNotExist:
            raise Http404 from None

        pipeline = services.calculer_pipeline(user=request.user, course=course)
        return Response(PipelineSerializer(pipeline).data)


class ChapterCompleteView(APIView):
    """POST /api/chapters/{slug}/complete — marque le chapitre terminé pour l'appelant."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        assert isinstance(request.user, User)

        try:
            enforce_rate_limit(
                "chapters:complete", str(request.user.pk), max_attempts=30, window_seconds=60
            )
        except TropDeTentativesError:
            return Response({"detail": MESSAGE_TROP_DE_TENTATIVES}, status=429)

        try:
            chapter = Chapter.objects.select_related("lesson", "module", "module__course").get(
                slug=slug
            )
        except Chapter.DoesNotExist:
            raise Http404 from None

        if not chapter.module.course.is_published:
            raise Http404

        # Même règle que le paywall (§4.4) : marquer terminé un chapitre qu'on n'a pas
        # le droit de voir n'apprend rien de plus qu'essayer de le lire — 404, pas 403.
        if not chapter.is_free and not enrollment_services.a_acces_au_contenu(
            request.user, chapter.module.course
        ):
            raise Http404

        services.terminer_chapitre(user=request.user, chapter=chapter)
        return Response(
            ChapterCompleteResponseSerializer(
                {"chapter_slug": chapter.slug, "state": "termine"}
            ).data,
            status=200,
        )

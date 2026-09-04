"""Vues de lecture vidéo. Deny by default sauf `AllowAny` explicite sur le chapitre gratuit.

Toute ressource inaccessible renvoie 404, jamais 403 : on ne confirme pas qu'une
leçon payante existe (§4.3). Les URL signées ne sont jamais reprises dans un
corps d'erreur.
"""

from __future__ import annotations

from uuid import UUID

from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.throttling import TropDeTentativesError
from apps.accounts.utils import get_client_ip
from apps.accounts.utils import ip_prefix as compute_ip_prefix
from apps.media import services
from apps.media.serializers import (
    HeartbeatRequestSerializer,
    HeartbeatResponseSerializer,
    PlaybackRequestSerializer,
    PlaybackResponseSerializer,
)

MESSAGE_TROP_DE_TENTATIVES = "Trop de tentatives. Réessaie plus tard."
MESSAGE_INDISPONIBLE = "Vidéo indisponible."


def _utilisateur(request: Request) -> User | None:
    return request.user if isinstance(request.user, User) else None


def _empreinte(request: Request) -> str:
    return (request.META.get("HTTP_X_DEVICE_FINGERPRINT") or "")[:255]


class LessonPlaybackView(APIView):
    """POST /api/lessons/{id}/playback — émet un jeton, invalide les précédents."""

    permission_classes = [AllowAny]

    def post(self, request: Request, lesson_id: int) -> Response:
        # On accepte un corps JSON (y compris des champs surnuméraires : is_staff,
        # role, …) sans en tirer le moindre droit.
        PlaybackRequestSerializer(data=request.data if request.data else {}).is_valid(
            raise_exception=False
        )

        ip = get_client_ip(request)
        try:
            lecture = services.emettre_jeton(
                lesson_id=lesson_id,
                user=_utilisateur(request),
                client_ip=ip,
                ip_prefix=compute_ip_prefix(ip),
                device_fingerprint=_empreinte(request),
            )
        except services.LectureRefuseeError:
            raise services.lecture_refusee_en_404() from None
        except TropDeTentativesError:
            return Response({"detail": MESSAGE_TROP_DE_TENTATIVES}, status=429)
        except services.BunnyNonConfigureError:
            return Response({"detail": MESSAGE_INDISPONIBLE}, status=503)

        return Response(PlaybackResponseSerializer(lecture).data, status=200)

    def get(self, request: Request, lesson_id: int) -> Response:
        raise services.lecture_refusee_en_404()


class PlaybackHeartbeatView(APIView):
    """POST /api/playback/{id}/heartbeat — session unique + position de lecture."""

    permission_classes = [AllowAny]

    def post(self, request: Request, playback_id: UUID) -> Response:
        serializer = HeartbeatRequestSerializer(data=request.data if request.data else {})
        serializer.is_valid(raise_exception=True)
        ip = get_client_ip(request)
        try:
            battement = services.battement(
                playback_id=playback_id,
                user=_utilisateur(request),
                ip_prefix=compute_ip_prefix(ip),
                watched_s=serializer.validated_data.get("watched_s"),
            )
        except services.JetonInvalideError:
            raise services.lecture_refusee_en_404() from None

        return Response(HeartbeatResponseSerializer(battement).data, status=200)

    def get(self, request: Request, playback_id: UUID) -> Response:
        raise services.lecture_refusee_en_404()

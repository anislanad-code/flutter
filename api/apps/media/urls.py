"""Routes de lecture vidéo. Montées sous `/api/` par `config.urls`."""

from __future__ import annotations

from django.urls import URLPattern, path

from apps.media.views import LessonPlaybackView, PlaybackHeartbeatView

urlpatterns: list[URLPattern] = [
    path("lessons/<int:lesson_id>/playback", LessonPlaybackView.as_view(), name="lesson-playback"),
    path(
        "playback/<uuid:playback_id>/heartbeat",
        PlaybackHeartbeatView.as_view(),
        name="playback-heartbeat",
    ),
]

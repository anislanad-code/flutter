"""Routes du pipeline. Aucune ne prend d'identifiant d'utilisateur (§4.3)."""

from __future__ import annotations

from django.urls import path

from apps.learning.views import ChapterCompleteView, ProgressView

urlpatterns = [
    path("progress", ProgressView.as_view(), name="progress"),
    path("chapters/<slug:slug>/complete", ChapterCompleteView.as_view(), name="chapter-complete"),
]

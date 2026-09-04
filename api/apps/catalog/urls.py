"""Routes `/api/public/*` — landing et chapitre gratuit (étape 2)."""

from __future__ import annotations

from django.urls import URLPattern, path

from apps.catalog.views import ChapterPublicDetailView, CoursePublicDetailView, LeadCreateView

urlpatterns: list[URLPattern] = [
    path("course/<slug:slug>", CoursePublicDetailView.as_view(), name="public-course-detail"),
    path("chapters/<slug:slug>", ChapterPublicDetailView.as_view(), name="public-chapter-detail"),
    path("leads", LeadCreateView.as_view(), name="public-leads"),
]

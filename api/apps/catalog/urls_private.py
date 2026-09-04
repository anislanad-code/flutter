"""Routes du catalogue réservées aux comptes connectés.

Séparées de `urls.py` (monté sous `/api/public/`) pour qu'on ne puisse pas ajouter par
inadvertance une route authentifiée sous un préfixe dont le nom promet le contraire.
"""

from __future__ import annotations

from django.urls import path

from apps.catalog.views import ChapterDetailView

urlpatterns = [
    path("chapters/<slug:slug>", ChapterDetailView.as_view(), name="chapter-detail"),
]

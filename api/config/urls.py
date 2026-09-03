"""Routage racine. Django n'est pas exposé publiquement : le seul client est Next."""

from django.conf import settings
from django.contrib import admin
from django.urls import URLPattern, URLResolver, path

from config.health import HealthView

# En production l'admin Django vit sur un chemin imprévisible, jamais sur /admin/ (§4.6).
admin_path: str = settings.DJANGO_ADMIN_PATH

urlpatterns: list[URLPattern | URLResolver] = [
    path("api/health", HealthView.as_view(), name="health"),
    path(f"{admin_path}/", admin.site.urls),
]

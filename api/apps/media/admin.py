"""Filet Django admin : consultation des jetons, jamais d'URL signée."""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.http import HttpRequest

from apps.media.models import PlaybackToken


@admin.register(PlaybackToken)
class PlaybackTokenAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["id", "user", "lesson", "issued_at", "expires_at", "consumed"]
    list_filter = ["consumed"]
    search_fields = ["user__email"]
    readonly_fields = [
        "id",
        "user",
        "lesson",
        "issued_at",
        "expires_at",
        "ip_prefix",
        "device_fingerprint",
        "consumed",
    ]

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

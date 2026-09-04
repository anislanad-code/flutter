"""Le journal se consulte, ne s'écrit pas et ne s'efface pas depuis l'interface (§4.6)."""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.http import HttpRequest

from apps.audit.models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["created_at", "action", "actor", "target_type", "target_id"]
    list_filter = ["action", "target_type"]
    search_fields = ["target_id", "actor__email"]
    readonly_fields = ["actor", "action", "target_type", "target_id", "metadata", "created_at"]

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

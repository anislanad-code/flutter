"""Filet de sécurité pour les tâches rares (CLAUDE.md §2). Jamais le fichier d'une preuve.

L'admin Django ne permet pas de télécharger une preuve : ce chemin-là passe
exclusivement par l'URL signée et journalisée de `/api/admin/proofs/{id}/url` (§4.5).
"""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.http import HttpRequest

from apps.enrollment.models import Enrollment, PaymentProof


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    """Le statut ne se change pas ici : `accepter_inscription` / `refuser_preuve` seulement.

    `note_admin` reste éditable — c'est le filet de sécurité du §2 pour une annotation
    hors parcours, sans transition d'état ni AuditLog manquant.
    """

    list_display = ["id", "user", "course", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["user__email"]
    readonly_fields = [
        "user",
        "course",
        "status",
        "activated_at",
        "activated_by",
        "created_at",
    ]

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(PaymentProof)
class PaymentProofAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["id", "enrollment", "status", "created_at", "purged_at"]
    list_filter = ["status"]
    readonly_fields = [
        "id",
        "enrollment",
        "file_key",
        "content_type",
        "byte_size",
        "amount_declared",
        "status",
        "reviewed_by",
        "reviewed_at",
        "reject_reason",
        "purge_after",
        "purged_at",
        "created_at",
    ]

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

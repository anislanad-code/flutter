"""Admin Django : filet de sécurité (§1), pas un panneau de gestion des mots de passe.

`password` est en lecture seule ci-dessous : même Anis n'a pas de formulaire pour définir
le mot de passe d'un compte tiers (CLAUDE.md §2 et §4.2).
"""

from __future__ import annotations

from django.contrib import admin

from apps.accounts.models import Session, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["email", "phone", "is_active", "is_staff", "flagged_for_review", "created_at"]
    search_fields = ["email", "phone"]
    list_filter = ["is_active", "is_staff", "flagged_for_review"]
    readonly_fields = ["password", "created_at", "last_activity_at"]
    fields = [
        "email",
        "phone",
        "password",
        "is_active",
        "is_staff",
        "flagged_for_review",
        "created_at",
        "last_activity_at",
    ]


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["id", "user", "created_at", "expires_at", "revoked_at"]
    search_fields = ["user__email"]
    readonly_fields = ["id", "refresh_token_hash", "created_at", "last_used_at"]

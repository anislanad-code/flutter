"""Filet de sécurité admin pour la progression (§1).

Lecture seule stricte, comme `PlaybackTokenAdmin` (étape 4) : la progression d'un
étudiant est une donnée qui conditionnera un certificat (étape 8) — l'admin la
consulte, il ne la falsifie pas depuis cette interface (§4.6 : toute modification
laisse une trace d'audit, or aucune n'existe ici pour ce modèle).
"""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.http import HttpRequest

from apps.learning.models import ModuleCompletion, Progress


class LectureSeuleAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(Progress)
class ProgressAdmin(LectureSeuleAdmin):
    list_display = ["user", "chapter", "state", "watched_s", "updated_at"]
    list_filter = ["state"]
    search_fields = ["user__email"]
    readonly_fields = ["user", "chapter", "state", "watched_s", "completed_at", "updated_at"]


@admin.register(ModuleCompletion)
class ModuleCompletionAdmin(LectureSeuleAdmin):
    list_display = ["user", "module", "exam_passed", "best_score", "passed_at"]
    list_filter = ["exam_passed"]
    search_fields = ["user__email"]
    readonly_fields = ["user", "module", "exam_passed", "best_score", "passed_at"]

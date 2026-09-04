"""Filet de sécurité admin pour la progression (§1)."""

from __future__ import annotations

from django.contrib import admin

from apps.learning.models import ModuleCompletion, Progress


@admin.register(Progress)
class ProgressAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["user", "chapter", "state", "watched_s", "updated_at"]
    list_filter = ["state"]
    readonly_fields = ["user", "chapter", "watched_s", "completed_at", "updated_at"]


@admin.register(ModuleCompletion)
class ModuleCompletionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["user", "module", "exam_passed", "best_score", "passed_at"]
    list_filter = ["exam_passed"]
    readonly_fields = ["user", "module", "exam_passed", "best_score", "passed_at"]

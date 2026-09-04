"""Filet de sécurité admin pour le contenu (§1 : l'admin publie le contenu)."""

from __future__ import annotations

from django.contrib import admin

from apps.catalog.models import Chapter, Course, Lead, Lesson, Module


class ChapterInline(admin.TabularInline):  # type: ignore[type-arg]
    model = Chapter
    extra = 0
    fields = ["order", "title", "slug", "is_free"]


class ModuleInline(admin.TabularInline):  # type: ignore[type-arg]
    model = Module
    extra = 0
    fields = ["order", "title"]


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["title", "slug", "is_published", "created_at"]
    inlines = [ModuleInline]


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["title", "course", "order"]
    inlines = [ChapterInline]


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["title", "module", "order", "is_free"]


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["chapter", "duration_s"]


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["email", "phone", "created_at"]
    readonly_fields = ["email", "phone", "ip_prefix", "created_at"]

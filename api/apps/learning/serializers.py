"""Serializers explicites (CLAUDE.md §7). `fields = '__all__'` interdit."""

from __future__ import annotations

from rest_framework import serializers

from apps.learning.services import EtatChapitre, EtatModule, EtatPipeline


class ChapterStateSerializer(serializers.Serializer[EtatChapitre]):
    id = serializers.IntegerField(source="chapter.id")
    slug = serializers.CharField(source="chapter.slug")
    order = serializers.IntegerField(source="chapter.order")
    title = serializers.CharField(source="chapter.title")
    is_free = serializers.BooleanField(source="chapter.is_free")
    state = serializers.CharField()


class ModuleStateSerializer(serializers.Serializer[EtatModule]):
    id = serializers.IntegerField(source="module_id")
    order = serializers.IntegerField()
    title = serializers.CharField()
    unlocked = serializers.BooleanField()
    completed_chapters = serializers.IntegerField()
    total_chapters = serializers.IntegerField()
    chapters = ChapterStateSerializer(many=True)


class PipelineSerializer(serializers.Serializer[EtatPipeline]):
    course_slug = serializers.CharField()
    resume_chapter_slug = serializers.CharField(allow_null=True)
    modules = ModuleStateSerializer(many=True)


class ChapterCompleteResponseSerializer(serializers.Serializer[dict[str, str]]):
    chapter_slug = serializers.CharField()
    state = serializers.CharField()

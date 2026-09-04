"""Serializers explicites (CLAUDE.md §7). Deux niveaux volontairement séparés :

- l'arbre de la formation ne renvoie jamais le contenu d'une leçon (§4.4) ;
- le détail d'un chapitre gratuit est le seul endroit qui renvoie une leçon complète.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.catalog.models import Chapter, Course, Lead, Lesson, Module


class ChapterSummarySerializer(serializers.ModelSerializer[Chapter]):
    """Aucun champ de `Lesson` ici : l'arbre de la formation ne contient pas son contenu."""

    class Meta:
        model = Chapter
        fields = ["id", "slug", "order", "title", "is_free"]
        read_only_fields = fields


class ModuleSummarySerializer(serializers.ModelSerializer[Module]):
    chapters = ChapterSummarySerializer(many=True, read_only=True)

    class Meta:
        model = Module
        fields = ["id", "order", "title", "summary", "chapters"]
        read_only_fields = fields


class CoursePublicSerializer(serializers.ModelSerializer[Course]):
    modules = ModuleSummarySerializer(many=True, read_only=True)

    class Meta:
        model = Course
        fields = ["slug", "title", "description", "modules"]
        read_only_fields = fields


class LessonSerializer(serializers.ModelSerializer[Lesson]):
    class Meta:
        model = Lesson
        fields = ["video_provider_id", "duration_s", "transcript", "resources"]
        read_only_fields = fields


class ChapterFreeDetailSerializer(serializers.ModelSerializer[Chapter]):
    """Renvoyé uniquement quand `is_free` est vrai (vérifié en vue, pas ici)."""

    lesson = LessonSerializer(read_only=True)
    module_title = serializers.CharField(source="module.title", read_only=True)
    course_slug = serializers.CharField(source="module.course.slug", read_only=True)
    course_title = serializers.CharField(source="module.course.title", read_only=True)

    class Meta:
        model = Chapter
        fields = [
            "id",
            "slug",
            "title",
            "is_free",
            "lesson",
            "module_title",
            "course_slug",
            "course_title",
        ]
        read_only_fields = fields


class LeadSerializer(serializers.ModelSerializer[Lead]):
    # Champ honeypot : un visiteur humain ne le remplit jamais, un bot le fait souvent.
    site = serializers.CharField(required=False, allow_blank=True, default="", write_only=True)
    # Horodatage (epoch ms) posé par le composant au montage du formulaire ; comparé au
    # temps serveur pour rejeter les soumissions plus rapides qu'un humain ne peut agir.
    form_rendered_at = serializers.IntegerField(write_only=True)

    class Meta:
        model = Lead
        fields = ["email", "phone", "site", "form_rendered_at"]

    def validate_phone(self, value: str) -> str:
        return value.strip()

"""Serializers explicites (CLAUDE.md §7). `fields = '__all__'` interdit.

Deux familles volontairement séparées : celle d'avant soumission (`EtatQuiz...`) ne
porte jamais `is_correct` ; celle d'après (`Resultat...`) est le seul endroit où ce
champ existe, et seulement parce que la tentative qu'elle décrit est déjà corrigée.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.assessment.models import Attempt
from apps.assessment.services import (
    ChoixCorrige,
    ChoixPublic,
    EtatQuiz,
    QuestionCorrigee,
    QuestionPublique,
    ResultatTentative,
)


class ChoixPublicSerializer(serializers.Serializer[ChoixPublic]):
    id = serializers.IntegerField()
    text = serializers.CharField()


class QuestionPubliqueSerializer(serializers.Serializer[QuestionPublique]):
    id = serializers.IntegerField()
    order = serializers.IntegerField()
    text = serializers.CharField()
    choices = ChoixPublicSerializer(many=True)


class EtatQuizSerializer(serializers.Serializer[EtatQuiz]):
    id = serializers.IntegerField()
    kind = serializers.CharField()
    pass_threshold = serializers.IntegerField()
    max_attempts = serializers.IntegerField()
    min_duration_s = serializers.IntegerField()
    attempts_used = serializers.IntegerField()
    attempts_remaining = serializers.IntegerField()
    best_score = serializers.IntegerField(allow_null=True)
    questions = QuestionPubliqueSerializer(many=True)


class AttemptStartSerializer(serializers.ModelSerializer[Attempt]):
    class Meta:
        model = Attempt
        fields = ["id", "started_at"]
        read_only_fields = fields


class ChoixCorrigeSerializer(serializers.Serializer[ChoixCorrige]):
    id = serializers.IntegerField()
    text = serializers.CharField()
    is_correct = serializers.BooleanField()
    chosen = serializers.BooleanField()


class QuestionCorrigeeSerializer(serializers.Serializer[QuestionCorrigee]):
    id = serializers.IntegerField()
    text = serializers.CharField()
    explanation = serializers.CharField()
    choices = ChoixCorrigeSerializer(many=True)


class ResultatTentativeSerializer(serializers.Serializer[ResultatTentative]):
    attempt_id = serializers.IntegerField()
    score = serializers.IntegerField()
    passed = serializers.BooleanField()
    pass_threshold = serializers.IntegerField()
    attempts_remaining = serializers.IntegerField()
    questions = QuestionCorrigeeSerializer(many=True)


class SubmitRequestSerializer(serializers.Serializer[dict[str, object]]):
    """`answers` : `{question_id: choice_id}`, clés en chaîne côté JSON (§7 — Zod fait
    la même validation de forme côté client, mais le serveur ne lui fait pas confiance).
    """

    answers = serializers.DictField(child=serializers.IntegerField(min_value=1), allow_empty=True)

    def validate_answers(self, value: dict[str, int]) -> dict[int, int]:
        resultat: dict[int, int] = {}
        for cle, choix_id in value.items():
            try:
                question_id = int(cle)
            except (TypeError, ValueError) as exc:
                raise serializers.ValidationError("Identifiant de question invalide.") from exc
            if question_id <= 0:
                raise serializers.ValidationError("Identifiant de question invalide.")
            resultat[question_id] = choix_id
        return resultat

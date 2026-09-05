"""Filet de sécurité admin (§1 : l'admin publie le contenu).

`Quiz`/`Question`/`Choice` sont du contenu édité par l'admin, comme le catalogue.
`Attempt` est une donnée d'étudiant : lecture seule, comme `Progress` (étape 5) — elle
alimentera un certificat (étape 8), l'admin la consulte, il ne la falsifie pas.
"""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.core.exceptions import ValidationError
from django.forms.models import BaseInlineFormSet
from django.http import HttpRequest

from apps.assessment.models import Attempt, Choice, Question, Quiz


class ChoiceInlineFormSet(BaseInlineFormSet):  # type: ignore[type-arg]
    """Exactement une bonne réponse par question — imposé à la saisie (§1 : l'admin est
    le seul outil d'édition de contenu). Le pendant base de données, « au plus une »,
    est défendu par `choice_une_seule_bonne_reponse_par_question` (`models.py`) ; « au
    moins une » ne peut se poser qu'ici, une contrainte ne pouvant pas exprimer
    « il existe au moins une ligne enfant ».
    """

    def clean(self) -> None:
        super().clean()
        if any(self.errors):
            return
        formulaires_actifs = [
            f for f in self.forms if f.cleaned_data and not f.cleaned_data.get("DELETE", False)
        ]
        if not formulaires_actifs:
            return
        correctes = sum(1 for f in formulaires_actifs if f.cleaned_data.get("is_correct"))
        if correctes != 1:
            raise ValidationError(
                "Cette question doit avoir exactement une bonne réponse "
                f"(actuellement {correctes})."
            )


class ChoiceInline(admin.TabularInline):  # type: ignore[type-arg]
    model = Choice
    formset = ChoiceInlineFormSet
    extra = 1
    fields = ["order", "text", "is_correct"]


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["quiz", "order", "text"]
    inlines = [ChoiceInline]


class QuestionInline(admin.TabularInline):  # type: ignore[type-arg]
    model = Question
    extra = 0
    fields = ["order", "text"]
    show_change_link = True


@admin.register(Quiz)
class QuizAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ["__str__", "kind", "pass_threshold", "max_attempts", "min_duration_s"]
    inlines = [QuestionInline]


class LectureSeuleAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False


@admin.register(Attempt)
class AttemptAdmin(LectureSeuleAdmin):
    list_display = ["user", "quiz", "score", "passed", "started_at", "submitted_at"]
    list_filter = ["passed"]
    search_fields = ["user__email"]
    readonly_fields = [
        "user",
        "quiz",
        "started_at",
        "submitted_at",
        "score",
        "passed",
        "answers",
    ]

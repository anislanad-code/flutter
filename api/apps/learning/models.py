"""Progression de lecture et de module (CLAUDE.md §5).

`Progress` porte l'état par chapitre — posé dès l'étape 4 pour `watched_s`, complété
ici avec les transitions `IN_PROGRESS` → `DONE`. `ModuleCompletion` existe dès
l'étape 5 pour correspondre au modèle de données de référence, mais son champ
`exam_passed` reste `False` pour tout le monde tant que l'étape 6 n'a pas posé les
QCM : il n'y a pas encore d'examen à réussir. Le déverrouillage du module suivant, à
cette étape, se calcule donc à la volée à partir de `Progress` (tous les chapitres du
module précédent à `DONE`), pas depuis cette table — voir `apps/learning/services.py`.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class Progress(models.Model):
    class State(models.TextChoices):
        NOT_STARTED = "NOT_STARTED", "Pas commencé"
        IN_PROGRESS = "IN_PROGRESS", "En cours"
        DONE = "DONE", "Terminé"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="progress"
    )
    chapter = models.ForeignKey(
        "catalog.Chapter", on_delete=models.CASCADE, related_name="progress"
    )
    state = models.CharField(max_length=16, choices=State.choices, default=State.NOT_STARTED)
    watched_s = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "chapter"], name="progress_unique_user_chapitre"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id} — chapitre {self.chapter_id} ({self.state})"


class ModuleCompletion(models.Model):
    """Réussite d'un module. Posée pour l'étape 6 (examens réels) : voir docstring du
    module. `best_score` reste `None` tant qu'aucune tentative n'existe.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="module_completions"
    )
    module = models.ForeignKey(
        "catalog.Module", on_delete=models.CASCADE, related_name="completions"
    )
    exam_passed = models.BooleanField(default=False)
    best_score = models.PositiveSmallIntegerField(null=True, blank=True)
    passed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "module"], name="module_completion_unique_user_module"
            )
        ]

    def __str__(self) -> str:
        etat = "réussi" if self.exam_passed else "en cours"
        return f"{self.user_id} — module {self.module_id} ({etat})"

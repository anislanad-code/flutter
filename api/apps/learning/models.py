"""Progression de lecture (amorce de l'étape 5).

L'étape 4 a besoin de `watched_s` pour reprendre à la position exacte. Les états
`NOT_STARTED` / `IN_PROGRESS` / `DONE` et la complétion de module arriveront
à l'étape 5 : on pose déjà les colonnes pour ne pas migrer deux fois le même
modèle.
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

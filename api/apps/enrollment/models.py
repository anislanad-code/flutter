"""Inscription d'un étudiant. Le lien vers `Course` et `PaymentProof` arrive à l'étape 2/3."""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class Enrollment(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "En attente"
        ACTIVE = "ACTIVE", "Actif"
        BLOCKED = "BLOCKED", "Bloqué"
        EXPIRED = "EXPIRED", "Expiré"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="enrollments"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    activated_at = models.DateTimeField(null=True, blank=True)
    activated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activations_effectuees",
    )
    note_admin = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"{self.user_id} — {self.status}"

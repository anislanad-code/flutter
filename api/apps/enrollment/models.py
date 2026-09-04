"""Inscription d'un étudiant et preuve de versement CCP (CLAUDE.md §5, §4.5).

`PaymentProof` ne stocke **jamais** le fichier lui-même en base ni sous la racine web :
seul `file_key` (un UUID) désigne l'objet dans le stockage privé chiffré. Voir
`apps/enrollment/storage.py`.
"""

from __future__ import annotations

import uuid
from typing import ClassVar

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.catalog.models import Course


class Enrollment(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "En attente"
        ACTIVE = "ACTIVE", "Actif"
        BLOCKED = "BLOCKED", "Bloqué"
        EXPIRED = "EXPIRED", "Expiré"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="enrollments"
    )
    # `PROTECT` : on ne supprime jamais une formation qui a des inscrits — la trace de
    # ce qui a été vendu doit survivre à un ménage dans le catalogue.
    # Nul tant qu'aucune formation n'est publiée au moment de l'inscription (§1 : la
    # plateforme accueillera d'autres formations, le lien n'est pas codé en dur).
    course = models.ForeignKey(
        Course,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="enrollments",
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

    class Meta:
        ordering = ["-created_at"]
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.UniqueConstraint(
                fields=["user", "course"], name="inscription_unique_par_user_et_cours"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} — {self.status}"

    @property
    def donne_acces_au_contenu(self) -> bool:
        """Seul `ACTIVE` ouvre le contenu payant (§4.4). `BLOCKED` et `EXPIRED` non."""
        return self.status == self.Status.ACTIVE


class PaymentProof(models.Model):
    """Capture du reçu CCP.

    Donnée personnelle sensible : chiffrée au repos, purgée 90 jours après examen (§4.5).
    """

    class Status(models.TextChoices):
        SUBMITTED = "SUBMITTED", "Déposée"
        ACCEPTED = "ACCEPTED", "Acceptée"
        REJECTED = "REJECTED", "Refusée"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    enrollment = models.ForeignKey(
        Enrollment, on_delete=models.CASCADE, related_name="payment_proofs"
    )
    # Nom généré côté serveur, jamais celui fourni par l'utilisateur (§4.5).
    file_key = models.CharField(max_length=128, unique=True)
    content_type = models.CharField(max_length=64)
    byte_size = models.PositiveIntegerField(default=0)
    amount_declared = models.PositiveIntegerField(help_text="Montant versé, en dinars.")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="preuves_examinees",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reject_reason = models.TextField(blank=True)
    # Date à partir de laquelle la commande de purge détruit le fichier (§4.5 : 90 jours
    # après validation). Nul tant que la preuve n'a pas été examinée.
    purge_after = models.DateTimeField(null=True, blank=True)
    purged_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["purge_after"]),
        ]

    def __str__(self) -> str:
        return f"preuve {self.id} — {self.status}"

    @property
    def est_lisible(self) -> bool:
        """Une preuve purgée n'a plus de fichier : ne jamais tenter de la servir."""
        return self.purged_at is None

"""Journal d'audit des actions admin (CLAUDE.md §4.6).

**Immuable par construction.** Une entrée écrite ne peut plus être modifiée ni supprimée :
`save()` refuse toute mise à jour, `delete()` lève. C'est la seule garantie qui compte —
un journal qu'on peut réécrire ne prouve rien le jour où on en a besoin.

Ce que le journal ne contient jamais : le contenu d'une preuve de paiement, une URL
signée, un token, un secret (§4.6). `metadata` porte des identifiants et des motifs,
pas des pièces jointes.
"""

from __future__ import annotations

from typing import Any, ClassVar, NoReturn

from django.conf import settings
from django.db import models
from django.utils import timezone


class AuditLogImmuableError(Exception):
    """Tentative de modifier ou supprimer une entrée déjà écrite."""


class AuditLog(models.Model):
    class Action(models.TextChoices):
        PROOF_SUBMITTED = "PROOF_SUBMITTED", "Preuve de paiement déposée"
        PROOF_VIEWED = "PROOF_VIEWED", "Preuve de paiement consultée"
        PROOF_PURGED = "PROOF_PURGED", "Preuve de paiement purgée"
        ENROLLMENT_ACCEPTED = "ENROLLMENT_ACCEPTED", "Inscription validée"
        ENROLLMENT_REJECTED = "ENROLLMENT_REJECTED", "Preuve refusée"

    # `SET_NULL` : supprimer un compte admin ne doit jamais effacer la trace de ses
    # actions. `actor` est nul pour les actions du système (purge planifiée).
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="actions_auditees",
    )
    action = models.CharField(max_length=32, choices=Action.choices)
    target_type = models.CharField(max_length=64)
    target_id = models.CharField(max_length=64)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=["action", "-created_at"]),
            models.Index(fields=["target_type", "target_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.action} {self.target_type}#{self.target_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        # `_state.adding` plutôt que `pk is None` : une entrée relue depuis la base
        # porte un pk *et* `adding = False`, alors qu'une entrée neuve à qui on aurait
        # fixé un pk à la main porte un pk mais reste en insertion. C'est bien la
        # réécriture d'une ligne existante qu'on interdit, pas la présence d'un pk.
        if not self._state.adding:
            raise AuditLogImmuableError("Une entrée d'audit ne peut pas être modifiée.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise AuditLogImmuableError("Une entrée d'audit ne peut pas être supprimée.")

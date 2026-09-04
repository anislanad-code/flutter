"""Jeton de lecture vidéo (CLAUDE.md §4.1, §5).

L'URL signée Bunny n'est **jamais** stockée : elle est recalculée à l'émission et
n'existe que dans la réponse HTTP, le temps d'un TTL de 5 minutes. Ce modèle ne
porte que ce dont on a besoin pour la session unique, la détection de partage et
le heartbeat (invalider une lecture ouverte sur un autre appareil).
"""

from __future__ import annotations

import uuid
from typing import ClassVar

from django.conf import settings
from django.db import models
from django.utils import timezone


class PlaybackToken(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Nul : lecture anonyme d'un chapitre `is_free` (landing, /gratuit).
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="playback_tokens",
    )
    lesson = models.ForeignKey(
        "catalog.Lesson",
        on_delete=models.CASCADE,
        related_name="playback_tokens",
    )
    issued_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    ip_prefix = models.CharField(max_length=64)
    device_fingerprint = models.CharField(max_length=255, blank=True)
    consumed = models.BooleanField(default=False)

    class Meta:
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=["user", "consumed", "expires_at"]),
            models.Index(fields=["user", "issued_at"]),
        ]

    def __str__(self) -> str:
        return f"playback {self.id} — lesson {self.lesson_id}"

    def est_actif(self) -> bool:
        return not self.consumed and self.expires_at > timezone.now()

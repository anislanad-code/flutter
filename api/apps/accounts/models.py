"""Comptes, sessions (familles de refresh tokens) et jetons de réinitialisation.

Voir CLAUDE.md §5. Les secrets de session et les jetons de reset ne sont jamais stockés
en clair : seul leur hachage SHA-256 est conservé (ce sont des valeurs aléatoires de haute
entropie générées côté serveur, pas des mots de passe — un hachage rapide suffit et évite
le coût d'Argon2 sur le chemin d'authentification à chaque requête).
"""

from __future__ import annotations

import uuid
from typing import ClassVar

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.accounts.managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    """Identifiant : l'email. Le statut admin ne peut jamais être défini depuis l'API (§4.3)."""

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=32, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    flagged_for_review = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    objects: ClassVar[UserManager] = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.email


class Session(models.Model):
    """Une famille de refresh tokens : un appareil / une connexion.

    `refresh_token_hash` est le hachage du secret *courant* de la famille. Une rotation
    réussie le remplace ; une réutilisation de l'ancien secret révoque toute la famille
    (§4.2 — détection de rejeu).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sessions")
    refresh_token_hash = models.CharField(max_length=64)
    device_fingerprint = models.CharField(max_length=255, blank=True)
    ip_prefix = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_used_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "revoked_at"])]

    def __str__(self) -> str:
        return f"session {self.id} — {self.user_id}"

    def is_valid(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()


class PasswordResetToken(models.Model):
    """Jeton à usage unique (§4.2). Le jeton en clair ne quitte jamais le serveur — seul
    son hachage est stocké ; il n'est comparé qu'à réception du même secret dans l'URL.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="password_resets")
    token_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "used_at"])]

    def __str__(self) -> str:
        return f"reset {self.id} — {self.user_id}"

    def is_valid(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()

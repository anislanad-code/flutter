"""Gestionnaire du modèle `User` : l'email est l'identifiant, pas un nom d'utilisateur."""

from __future__ import annotations

from typing import Any

from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):  # type: ignore[type-arg]
    """Crée les comptes avec un email normalisé et un mot de passe haché."""

    use_in_migrations = True

    def _creer(self, email: str, password: str | None, **extra: Any) -> Any:
        if not email:
            raise ValueError("L'email est obligatoire.")
        email = self.normalize_email(email).lower()
        utilisateur = self.model(email=email, **extra)
        utilisateur.set_password(password)
        utilisateur.save(using=self._db)
        return utilisateur

    def create_user(self, email: str, password: str | None = None, **extra: Any) -> Any:
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._creer(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra: Any) -> Any:
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Un superutilisateur doit avoir is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Un superutilisateur doit avoir is_superuser=True.")
        return self._creer(email, password, **extra)

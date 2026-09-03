"""Invariantes de configuration de CLAUDE.md §4. Rejouées à chaque étape."""

import importlib

import pytest
from django.conf import settings


def test_argon2_est_le_premier_hacheur() -> None:
    assert settings.PASSWORD_HASHERS[0].endswith("Argon2PasswordHasher")


def test_drf_refuse_par_defaut() -> None:
    assert settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] == [
        "rest_framework.permissions.IsAuthenticated"
    ]


def test_cors_n_autorise_jamais_toutes_les_origines() -> None:
    assert settings.CORS_ALLOW_ALL_ORIGINS is False
    assert "*" not in settings.CORS_ALLOWED_ORIGINS


def test_les_cookies_sont_httponly_et_samesite_strict() -> None:
    assert settings.SESSION_COOKIE_HTTPONLY is True
    assert settings.SESSION_COOKIE_SAMESITE == "Strict"
    assert settings.CSRF_COOKIE_SAMESITE == "Strict"


def test_le_mot_de_passe_fait_au_moins_dix_caracteres() -> None:
    longueur = next(
        v["OPTIONS"]["min_length"]
        for v in settings.AUTH_PASSWORD_VALIDATORS
        if v["NAME"].endswith("MinimumLengthValidator")
    )
    assert longueur >= 10


def test_les_reglages_de_production_sont_durcis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lecture directe du module prod : ce n'est pas lui qui est actif pendant les tests."""
    monkeypatch.setenv("DJANGO_ADMIN_PATH", "chemin-secret")
    monkeypatch.setenv("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
    monkeypatch.setenv("DEFAULT_FROM_EMAIL", "contact@anis.dev")
    prod = importlib.reload(importlib.import_module("config.settings.prod"))

    assert prod.DEBUG is False
    assert prod.SESSION_COOKIE_SECURE is True
    assert prod.CSRF_COOKIE_SECURE is True
    assert prod.SECURE_HSTS_SECONDS >= 31_536_000
    assert prod.SECURE_HSTS_PRELOAD is True
    assert prod.SECURE_SSL_REDIRECT is True

"""Invariantes de CLAUDE.md §4. Rejouées telles quelles à chaque étape.

Certaines sont volontairement « vides » à l'étape 0 : le harnais existe et se remplira
tout seul quand les serializers et les routes apparaîtront. Une régression future les
fait tomber sans qu'on ait à y penser.
"""

import contextlib
import importlib
import re

import pytest
from django.conf import settings
from django.urls import URLPattern, get_resolver, reverse
from rest_framework import serializers
from rest_framework.test import APIClient


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


# --- Invariantes rejouées à chaque étape (CLAUDE.md §4) --------------------


def _serializers_du_projet() -> list[type[serializers.BaseSerializer]]:
    """Toutes les classes de serializer définies sous `apps.`, chargées à la demande."""
    for application in (a for a in settings.INSTALLED_APPS if a.startswith("apps.")):
        with contextlib.suppress(ModuleNotFoundError):
            importlib.import_module(f"{application}.serializers")

    trouves: list[type[serializers.BaseSerializer]] = []
    a_visiter: list[type] = [serializers.BaseSerializer]
    while a_visiter:
        classe = a_visiter.pop()
        for enfant in classe.__subclasses__():
            a_visiter.append(enfant)
            if enfant.__module__.startswith("apps."):
                trouves.append(enfant)
    return trouves


def test_aucun_serializer_n_expose_is_correct() -> None:
    """La bonne réponse d'un QCM ne quitte jamais le serveur (§4.4)."""
    for classe in _serializers_du_projet():
        champs_declares = set(getattr(classe, "_declared_fields", {}))
        meta = getattr(classe, "Meta", None)
        champs_meta = set(getattr(meta, "fields", ()) or ())

        assert "is_correct" not in champs_declares, classe
        assert "is_correct" not in champs_meta, classe
        assert getattr(meta, "fields", None) != "__all__", classe


@pytest.mark.django_db
def test_aucune_reponse_publique_ne_contient_d_url_video_brute(api_client: APIClient) -> None:
    """§4.1 : aucune URL de fichier vidéo ne transite vers le client."""
    empreintes = re.compile(r"b-cdn\.net|mediadelivery\.net|\.mp4|\.m3u8", re.IGNORECASE)

    corps = api_client.get(reverse("health")).content.decode(errors="ignore")

    assert empreintes.search(corps) is None


def test_aucune_route_ne_permet_de_definir_le_mot_de_passe_d_un_tiers() -> None:
    """§4.2 : l'admin ne dispose d'aucun moyen de fixer le mot de passe d'un compte."""
    interdits = re.compile(r"password|mot-de-passe|set-password", re.IGNORECASE)
    routes = [
        str(entree.pattern)
        for entree in get_resolver().url_patterns
        if isinstance(entree, URLPattern)
    ]

    assert [route for route in routes if interdits.search(route)] == []

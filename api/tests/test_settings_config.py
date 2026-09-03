"""Invariantes de configuration introduites par l'étape 0 (CLAUDE.md §4.6, §7).

Le module `config.settings.prod` n'est pas celui qui tourne pendant les tests : on le
recharge à la main avec un environnement contrôlé, puis on le remet en état.
"""

import importlib
import os
import subprocess
import sys
from collections.abc import Iterator
from types import ModuleType

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

PROD = "config.settings.prod"
ENV_PROD_VALIDE = {
    "DJANGO_ADMIN_PATH": "ops-3f9a2b",
    "EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
    "DEFAULT_FROM_EMAIL": "contact@anis.dev",
}


def _charger_prod(monkeypatch: pytest.MonkeyPatch, **surcharges: str | None) -> ModuleType:
    variables = {**ENV_PROD_VALIDE, **surcharges}
    for cle, valeur in variables.items():
        if valeur is None:
            monkeypatch.delenv(cle, raising=False)
        else:
            monkeypatch.setenv(cle, valeur)
    return importlib.reload(importlib.import_module(PROD))


@pytest.fixture(autouse=True)
def restaurer_module_prod() -> Iterator[None]:
    """Un rechargement raté laisse le module à moitié construit : on le répare après."""
    yield
    with pytest.MonkeyPatch.context() as mp:
        for cle, valeur in ENV_PROD_VALIDE.items():
            mp.setenv(cle, valeur)
        importlib.reload(importlib.import_module(PROD))


# --- Socle commun ----------------------------------------------------------


def test_la_base_de_donnees_est_postgresql() -> None:
    """CLAUDE.md §2 : PostgreSQL, y compris pour les tests. Jamais SQLite."""
    assert settings.DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql"


def test_les_huit_applications_du_domaine_sont_declarees() -> None:
    attendues = {
        "apps.accounts",
        "apps.enrollment",
        "apps.catalog",
        "apps.learning",
        "apps.assessment",
        "apps.media",
        "apps.certification",
        "apps.audit",
    }

    assert attendues <= set(settings.INSTALLED_APPS)


def test_drf_n_expose_pas_l_api_navigable() -> None:
    """Le renderer HTML de DRF divulgue le schéma et permet d'explorer l'API au clic."""
    rendus = settings.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"]

    assert rendus == ["rest_framework.renderers.JSONRenderer"]
    assert all("Browsable" not in rendu for rendu in rendus)


def test_drf_n_active_aucune_authentification_implicite() -> None:
    """Chaque mécanisme d'authentification sera déclaré explicitement à l'étape 1."""
    assert settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] == []
    assert settings.REST_FRAMEWORK["UNAUTHENTICATED_USER"] is None


def test_les_en_tetes_de_securite_du_socle_sont_poses() -> None:
    assert settings.SECURE_CONTENT_TYPE_NOSNIFF is True
    assert settings.X_FRAME_OPTIONS == "DENY"
    assert settings.SECURE_REFERRER_POLICY == "strict-origin-when-cross-origin"


def test_les_origines_csrf_ne_sont_jamais_ouvertes() -> None:
    assert "*" not in settings.CSRF_TRUSTED_ORIGINS


def test_la_journalisation_n_active_pas_le_journal_sql() -> None:
    """`django.db.backends` en DEBUG écrit les requêtes et leurs paramètres (§4.6)."""
    journaux = settings.LOGGING.get("loggers", {})

    assert "django.db.backends" not in journaux
    assert settings.LOGGING["root"]["level"] != "DEBUG"


def test_une_cle_secrete_absente_empeche_le_demarrage() -> None:
    """`base.py` ne donne aucune valeur par défaut : sans clé, le processus meurt."""
    environnement = {c: v for c, v in os.environ.items() if c != "DJANGO_SECRET_KEY"}

    resultat = subprocess.run(  # noqa: S603
        [sys.executable, "-c", "import django; django.setup()"],
        env=environnement,
        capture_output=True,
        text=True,
        cwd=str(settings.BASE_DIR),
        check=False,
        timeout=60,
    )

    assert resultat.returncode != 0
    assert "DJANGO_SECRET_KEY" in resultat.stderr
    assert "ImproperlyConfigured" in resultat.stderr


def test_un_chemin_d_admin_vide_empeche_le_demarrage_meme_en_developpement() -> None:
    """Le garde-fou est dans `base.py` : aucun environnement ne monte l'admin à la racine."""
    environnement = {**os.environ, "DJANGO_ADMIN_PATH": ""}

    resultat = subprocess.run(  # noqa: S603
        [sys.executable, "-c", "import django; django.setup()"],
        env=environnement,
        capture_output=True,
        text=True,
        cwd=str(settings.BASE_DIR),
        check=False,
        timeout=60,
    )

    assert resultat.returncode != 0
    assert "DJANGO_ADMIN_PATH" in resultat.stderr


# --- Développement ---------------------------------------------------------


def test_le_developpement_ne_relache_que_le_drapeau_secure() -> None:
    """Sans HTTPS en local, `Secure` saute — httpOnly et SameSite, jamais."""
    dev = importlib.import_module("config.settings.dev")

    assert dev.SESSION_COOKIE_SECURE is False
    assert dev.CSRF_COOKIE_SECURE is False
    assert dev.SESSION_COOKIE_HTTPONLY is True
    assert dev.SESSION_COOKIE_SAMESITE == "Strict"
    assert dev.CORS_ALLOW_ALL_ORIGINS is False


# --- Production ------------------------------------------------------------


def test_la_production_exige_un_chemin_d_admin_explicite(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ImproperlyConfigured, match="DJANGO_ADMIN_PATH"):
        _charger_prod(monkeypatch, DJANGO_ADMIN_PATH=None)


def test_la_production_exige_une_configuration_email(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ImproperlyConfigured, match="EMAIL_BACKEND"):
        _charger_prod(monkeypatch, EMAIL_BACKEND=None)


@pytest.mark.parametrize("valeur", ["", "   ", "/", " / "])
def test_un_chemin_d_admin_vide_empeche_le_demarrage(
    monkeypatch: pytest.MonkeyPatch, valeur: str
) -> None:
    """Une ligne `.env` laissée en blanc montait l'admin Django à la racine du site.

    `DJANGO_ADMIN_PATH=` n'est pas une variable absente : elle est présente et vide.
    `urlpatterns` devenait alors `['api/health', '/']` et `GET /%2Flogin/` renvoyait
    le formulaire de connexion de l'admin. Constaté par la porte de sécurité de
    l'étape 0, ÉLEVÉ-E2.
    """
    with pytest.raises(ImproperlyConfigured, match="DJANGO_ADMIN_PATH"):
        _charger_prod(monkeypatch, DJANGO_ADMIN_PATH=valeur)


def test_la_production_refuse_le_chemin_d_admin_par_defaut(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Renseigner « admin » revient à ne rien renseigner : la production le refuse."""
    with pytest.raises(ImproperlyConfigured, match="DJANGO_ADMIN_PATH"):
        _charger_prod(monkeypatch, DJANGO_ADMIN_PATH="admin")


def test_le_chemin_d_admin_est_normalise() -> None:
    """Les barres obliques encadrantes sont retirées : sinon le motif d'URL dérape."""
    assert not settings.DJANGO_ADMIN_PATH.startswith("/")
    assert not settings.DJANGO_ADMIN_PATH.endswith("/")


def test_la_production_ne_sert_pas_l_admin_sur_le_chemin_par_defaut(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prod = _charger_prod(monkeypatch)

    assert prod.DJANGO_ADMIN_PATH == "ops-3f9a2b"
    assert prod.DJANGO_ADMIN_PATH != "admin"


def test_la_production_termine_le_tls_derriere_le_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    prod = _charger_prod(monkeypatch)

    assert prod.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")
    assert prod.SECURE_HSTS_INCLUDE_SUBDOMAINS is True


def test_la_production_herite_des_invariantes_du_socle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le `import *` ne doit rien perdre : les garde-fous du socle valent aussi en prod."""
    prod = _charger_prod(monkeypatch)

    assert prod.CORS_ALLOW_ALL_ORIGINS is False
    assert prod.SESSION_COOKIE_HTTPONLY is True
    assert prod.SESSION_COOKIE_SAMESITE == "Strict"
    assert prod.CSRF_COOKIE_HTTPONLY is True
    assert prod.PASSWORD_HASHERS[0].endswith("Argon2PasswordHasher")
    assert prod.X_FRAME_OPTIONS == "DENY"

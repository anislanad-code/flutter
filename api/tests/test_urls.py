"""Routage racine : ce qui est exposé, où vit l'admin, et surtout ce qui n'existe pas."""

import importlib
from collections.abc import Callable, Iterator

import pytest
from django.urls import URLPattern, URLResolver, clear_url_caches, get_resolver, resolve, reverse
from pytest_django.fixtures import SettingsWrapper
from rest_framework.test import APIClient

from config.health import HealthView


def _recharger_urlconf() -> None:
    importlib.reload(importlib.import_module("config.urls"))
    clear_url_caches()


@pytest.fixture
def routage(settings: SettingsWrapper) -> Iterator[Callable[[str], None]]:
    """Permet de rejouer `config/urls.py` avec un autre chemin d'admin.

    `urls.py` lit `DJANGO_ADMIN_PATH` à l'import : sans rechargement, changer le
    réglage ne change rien. Le teardown remet le routage d'origine.
    """

    def _appliquer(chemin: str) -> None:
        settings.DJANGO_ADMIN_PATH = chemin
        _recharger_urlconf()

    yield _appliquer

    settings.finalize()
    _recharger_urlconf()


def _routes_applicatives() -> list[str]:
    """Les motifs de premier niveau, admin Django exclu (ce n'est pas notre code)."""
    return [
        str(entree.pattern)
        for entree in get_resolver().url_patterns
        if isinstance(entree, URLPattern)
    ]


def test_la_sonde_est_exposee_sur_api_health() -> None:
    assert reverse("health") == "/api/health"
    assert resolve("/api/health").func.view_class is HealthView  # type: ignore[attr-defined]


def test_le_routage_n_expose_que_la_sonde_l_auth_et_l_admin() -> None:
    """Garde-fou : toute route ajoutée sans test fait tomber celui-ci."""
    resolveurs = [e for e in get_resolver().url_patterns if isinstance(e, URLResolver)]

    assert _routes_applicatives() == ["api/health"]
    # apps.accounts.urls (préfixe "api/") et admin.site.urls, et rien d'autre.
    assert len(resolveurs) == 2


def test_les_routes_d_authentification_sont_exposees_sous_api() -> None:
    noms = [
        "auth-register",
        "auth-login",
        "auth-refresh",
        "auth-logout",
        "auth-logout-all",
        "auth-password-reset-request",
        "auth-password-reset-confirm",
        "me",
    ]
    for nom in noms:
        assert reverse(nom).startswith("/api/")


@pytest.mark.django_db
def test_l_admin_django_vit_sur_le_chemin_configure(
    api_client: APIClient, routage: Callable[[str], None]
) -> None:
    routage("ops-3f9a2b")

    assert api_client.get("/ops-3f9a2b/").status_code in (200, 302)


@pytest.mark.django_db
def test_l_admin_django_est_introuvable_sur_admin_quand_le_chemin_est_change(
    api_client: APIClient, routage: Callable[[str], None]
) -> None:
    """CLAUDE.md §4.6 : en production, /admin/ ne doit rien révéler."""
    routage("ops-3f9a2b")

    assert api_client.get("/admin/").status_code == 404
    assert api_client.get("/admin/login/").status_code == 404


@pytest.mark.django_db
def test_une_route_inexistante_renvoie_404_sans_bavardage(
    api_client: APIClient, settings: SettingsWrapper, routage: Callable[[str], None]
) -> None:
    """Hors débogage, un 404 ne liste ni les routes ni le chemin de l'admin."""
    settings.DEBUG = False
    settings.ALLOWED_HOSTS = [*settings.ALLOWED_HOSTS, "testserver"]
    routage("ops-3f9a2b")

    reponse = api_client.get("/api/inexistant")

    assert reponse.status_code == 404
    corps = reponse.content.decode(errors="ignore").lower()
    assert "traceback" not in corps
    assert "ops-3f9a2b" not in corps
    assert "urlpatterns" not in corps

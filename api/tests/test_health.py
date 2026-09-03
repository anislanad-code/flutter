"""Sonde de santé : chemin nominal, base indisponible, accès public."""

from typing import Any
from unittest.mock import patch

import pytest
from django.db import DatabaseError, connection
from django.urls import reverse
from rest_framework.permissions import AllowAny
from rest_framework.test import APIClient

from config.health import HealthView


@pytest.mark.django_db
def test_health_repond_ok_quand_la_base_repond(api_client: APIClient) -> None:
    response = api_client.get(reverse("health"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


@pytest.mark.django_db
def test_health_repond_503_quand_la_base_est_injoignable(api_client: APIClient) -> None:
    with patch("config.health.connection.cursor", side_effect=DatabaseError("boom")):
        response = api_client.get(reverse("health"))

    assert response.status_code == 503
    assert response.json()["db"] == "down"


@pytest.mark.django_db
def test_health_ne_divulgue_aucun_detail_technique(api_client: APIClient) -> None:
    """Ni version, ni nom de base, ni trace : la sonde dit oui ou non, rien d'autre."""
    with patch("config.health.connection.cursor", side_effect=DatabaseError("secret")):
        payload: dict[str, Any] = api_client.get(reverse("health")).json()

    assert set(payload) == {"status", "db"}
    assert "secret" not in str(payload)


@pytest.mark.django_db
@pytest.mark.parametrize("methode", ["post", "put", "patch", "delete"])
def test_health_refuse_toute_methode_autre_que_get(api_client: APIClient, methode: str) -> None:
    """Une sonde ne fait que lire. Tout le reste est 405, pas 500."""
    reponse = getattr(api_client, methode)(reverse("health"))

    assert reponse.status_code == 405


@pytest.mark.django_db
def test_health_repond_du_json_sans_authentification(api_client: APIClient) -> None:
    """Seule exception publique déclarée à `IsAuthenticated` (§4.3), et elle est explicite."""
    reponse = api_client.get(reverse("health"))

    assert reponse["Content-Type"].startswith("application/json")
    assert HealthView.permission_classes == [AllowAny]
    assert HealthView.authentication_classes == []


@pytest.mark.django_db
def test_health_ne_pose_aucun_cookie(api_client: APIClient) -> None:
    """Un endpoint non authentifié n'a aucune raison d'ouvrir une session."""
    reponse = api_client.get(reverse("health"))

    assert reponse.cookies == {}


@pytest.mark.django_db
def test_health_interroge_reellement_la_base(api_client: APIClient) -> None:
    """Sans requête SQL, la sonde mentirait : elle dirait « ok » base éteinte."""
    with patch("config.health.connection.cursor", wraps=connection.cursor) as espion:
        reponse = api_client.get(reverse("health"))

    assert espion.call_count == 1
    assert reponse.json()["db"] == "ok"


@pytest.mark.django_db
def test_health_annonce_un_service_degrade_quand_la_base_est_tombee(
    api_client: APIClient,
) -> None:
    """Le corps dit la même chose que le code HTTP : 503 et « degraded », pas « ok »."""
    with patch("config.health.connection.cursor", side_effect=DatabaseError("boom")):
        reponse = api_client.get(reverse("health"))

    assert reponse.status_code == 503
    assert reponse.json() == {"status": "degraded", "db": "down"}

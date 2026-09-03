"""Sonde de santé : chemin nominal, base indisponible, accès public."""

from typing import Any
from unittest.mock import patch

import pytest
from django.db import DatabaseError
from django.urls import reverse
from rest_framework.test import APIClient


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

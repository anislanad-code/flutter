from __future__ import annotations

import time

import pytest
from rest_framework.test import APIClient

from apps.catalog.models import Lead
from apps.catalog.services import DELAI_MINIMUM_SOUMISSION_MS

pytestmark = pytest.mark.django_db


def _payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "email": "visiteuse@example.com",
        "phone": "0555000000",
        "site": "",
        "form_rendered_at": int(time.time() * 1000) - DELAI_MINIMUM_SOUMISSION_MS - 500,
    }
    base.update(overrides)
    return base


def test_soumission_legitime_cree_le_lead(api_client: APIClient) -> None:
    reponse = api_client.post("/api/public/leads", _payload(), format="json")

    assert reponse.status_code == 201
    assert Lead.objects.filter(email="visiteuse@example.com").exists()


def test_honeypot_rempli_ne_cree_rien_mais_repond_pareil(api_client: APIClient) -> None:
    reponse = api_client.post(
        "/api/public/leads", _payload(site="http://spam.example"), format="json"
    )

    assert reponse.status_code == 201
    assert reponse.json() == {"detail": "Inscrit à la liste d'attente."}
    assert not Lead.objects.exists()


def test_soumission_trop_rapide_ne_cree_rien_mais_repond_pareil(api_client: APIClient) -> None:
    reponse = api_client.post(
        "/api/public/leads",
        _payload(form_rendered_at=int(time.time() * 1000)),
        format="json",
    )

    assert reponse.status_code == 201
    assert not Lead.objects.exists()


def test_email_invalide_est_rejete(api_client: APIClient) -> None:
    reponse = api_client.post("/api/public/leads", _payload(email="pas-un-email"), format="json")

    assert reponse.status_code == 400
    assert not Lead.objects.exists()


def test_rate_limit_ip_bloque_apres_le_seuil(api_client: APIClient) -> None:
    for _ in range(5):
        reponse = api_client.post(
            "/api/public/leads", _payload(email=f"a{_}@example.com"), format="json"
        )
        assert reponse.status_code == 201

    reponse = api_client.post(
        "/api/public/leads", _payload(email="depassement@example.com"), format="json"
    )
    assert reponse.status_code == 429

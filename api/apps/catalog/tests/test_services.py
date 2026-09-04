from __future__ import annotations

import time

import pytest

from apps.catalog.models import Lead
from apps.catalog.services import DELAI_MINIMUM_SOUMISSION_MS, SoumissionSuspecteError, creer_lead

pytestmark = pytest.mark.django_db


def test_creer_lead_stocke_le_prefixe_ip_pas_lip_complete() -> None:
    lead = creer_lead(
        email="a@example.com",
        phone="",
        site="",
        form_rendered_at=int(time.time() * 1000) - DELAI_MINIMUM_SOUMISSION_MS - 100,
        ip_prefix="41.226.0.0/16",
    )
    assert lead.ip_prefix == "41.226.0.0/16"


def test_creer_lead_leve_si_honeypot() -> None:
    with pytest.raises(SoumissionSuspecteError):
        creer_lead(email="a@example.com", phone="", site="rempli", form_rendered_at=0, ip_prefix="")
    assert not Lead.objects.exists()


def test_creer_lead_leve_si_trop_rapide() -> None:
    with pytest.raises(SoumissionSuspecteError):
        creer_lead(
            email="a@example.com",
            phone="",
            site="",
            form_rendered_at=int(time.time() * 1000),
            ip_prefix="",
        )
    assert not Lead.objects.exists()

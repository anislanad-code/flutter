from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.catalog.models import Chapter, Course, Module

pytestmark = pytest.mark.django_db


def test_chapitre_gratuit_renvoie_le_contenu_complet(
    api_client: APIClient, chapitre_gratuit: Chapter
) -> None:
    reponse = api_client.get(f"/api/public/chapters/{chapitre_gratuit.slug}")

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["is_free"] is True
    assert "flutter doctor" in corps["lesson"]["transcript"]
    assert "id" in corps["lesson"]
    assert "video_provider_id" not in corps["lesson"]


def test_chapitre_payant_est_inaccessible_par_lapi_publique(
    api_client: APIClient, chapitre_payant: Chapter
) -> None:
    """§4.4 : le chapitre gratuit est le SEUL contenu accessible sans inscription active.
    Un 404, jamais un 403 — on ne confirme même pas que le chapitre existe (§4.3).
    """
    reponse = api_client.get(f"/api/public/chapters/{chapitre_payant.slug}")

    assert reponse.status_code == 404
    corps_brut = reponse.content.decode()
    assert "bunny-secret-id" not in corps_brut
    assert "réservé aux inscrits" not in corps_brut


def test_chapitre_dun_cours_non_publie_404_meme_sil_est_marque_libre(
    api_client: APIClient, cours_non_publie: Course
) -> None:
    module = Module.objects.create(course=cours_non_publie, order=0, title="Mise en route")
    chapitre = Chapter.objects.create(
        module=module, slug="chapitre-fantome", order=1, title="Fantôme", is_free=True
    )
    reponse = api_client.get(f"/api/public/chapters/{chapitre.slug}")
    assert reponse.status_code == 404


def test_chapitre_inexistant_404(api_client: APIClient) -> None:
    reponse = api_client.get("/api/public/chapters/nexiste-pas")
    assert reponse.status_code == 404

from __future__ import annotations

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.catalog.models import Course

pytestmark = pytest.mark.django_db


def test_cours_publie_renvoie_la_structure(
    api_client: APIClient, cours: Course, chapitre_gratuit: Any
) -> None:
    reponse = api_client.get(f"/api/public/course/{cours.slug}")

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["slug"] == cours.slug
    assert corps["modules"][0]["chapters"][0]["is_free"] is True


def test_arbre_public_ne_contient_jamais_le_contenu_dune_lecon(
    api_client: APIClient, cours: Course, chapitre_gratuit: Any
) -> None:
    """§4.4 : l'API de contenu renvoie un chapitre à la fois, jamais l'arbre complet
    avec les contenus. Même le chapitre gratuit ne montre pas sa leçon dans l'arbre.
    """
    reponse = api_client.get(f"/api/public/course/{cours.slug}")

    corps_brut = reponse.content.decode()
    assert "flutter doctor" not in corps_brut
    chapitre = reponse.json()["modules"][0]["chapters"][0]
    assert "lesson" not in chapitre
    assert "transcript" not in chapitre


def test_cours_inexistant_404(api_client: APIClient) -> None:
    reponse = api_client.get("/api/public/course/nexiste-pas")
    assert reponse.status_code == 404


def test_cours_non_publie_404(api_client: APIClient, cours_non_publie: Course) -> None:
    """Ne pas confirmer l'existence d'un cours en préparation (§4.3)."""
    reponse = api_client.get(f"/api/public/course/{cours_non_publie.slug}")
    assert reponse.status_code == 404


def test_reponse_sans_authentification_requise(api_client: APIClient, cours: Course) -> None:
    """Aucun cookie, aucun header d'auth : c'est une route AllowAny (§4.3)."""
    reponse = api_client.get(f"/api/public/course/{cours.slug}")
    assert reponse.status_code == 200

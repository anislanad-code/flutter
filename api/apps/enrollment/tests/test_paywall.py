"""Le paywall (CLAUDE.md §4.4, checklist §8 point 4).

Un compte `PENDING` n'accède à aucun chapitre non gratuit, par aucun chemin : route
publique, route authentifiée, message d'erreur bavard. La réponse doit être une 404
identique à celle d'un chapitre inexistant — jamais une 403, qui confirmerait que le
chapitre existe et qu'il suffit de payer pour savoir quoi.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Chapter
from apps.enrollment.models import Enrollment
from apps.enrollment.services import a_acces_au_contenu

pytestmark = pytest.mark.django_db


def _activer(user: User) -> None:
    Enrollment.objects.filter(user=user).update(status=Enrollment.Status.ACTIVE)


# --- Route authentifiée ----------------------------------------------------


def test_le_chapitre_authentifie_exige_une_session(
    api_client: APIClient, chapitre_payant: Chapter
) -> None:
    assert api_client.get(f"/api/chapters/{chapitre_payant.slug}").status_code == 401


def test_un_compte_pending_ne_voit_pas_un_chapitre_payant(
    client_etudiante: APIClient, inscription: Enrollment, chapitre_payant: Chapter
) -> None:
    reponse = client_etudiante.get(f"/api/chapters/{chapitre_payant.slug}")

    assert reponse.status_code == 404
    assert chapitre_payant.title not in reponse.content.decode()
    assert "réservé aux inscrits" not in reponse.content.decode()


def test_la_reponse_est_identique_a_celle_d_un_chapitre_inexistant(
    client_etudiante: APIClient, inscription: Enrollment, chapitre_payant: Chapter
) -> None:
    """Bit pour bit : sinon la différence est elle-même l'information (§4.3)."""
    payant = client_etudiante.get(f"/api/chapters/{chapitre_payant.slug}")
    inexistant = client_etudiante.get("/api/chapters/ce-chapitre-n-existe-pas")

    assert payant.status_code == inexistant.status_code == 404
    assert payant.content == inexistant.content


def test_un_compte_pending_voit_le_chapitre_gratuit(
    client_etudiante: APIClient, inscription: Enrollment, chapitre_gratuit: Chapter
) -> None:
    reponse = client_etudiante.get(f"/api/chapters/{chapitre_gratuit.slug}")

    assert reponse.status_code == 200
    assert reponse.data["title"] == chapitre_gratuit.title


def test_un_compte_actif_voit_le_chapitre_payant(
    client_etudiante: APIClient, inscription: Enrollment, chapitre_payant: Chapter, etudiante: User
) -> None:
    _activer(etudiante)

    reponse = client_etudiante.get(f"/api/chapters/{chapitre_payant.slug}")

    assert reponse.status_code == 200
    assert reponse.data["title"] == chapitre_payant.title


@pytest.mark.parametrize("statut", [Enrollment.Status.BLOCKED, Enrollment.Status.EXPIRED])
def test_ni_bloque_ni_expire_n_ouvrent_le_contenu(
    client_etudiante: APIClient,
    inscription: Enrollment,
    chapitre_payant: Chapter,
    statut: str,
) -> None:
    """Seul `ACTIVE` ouvre : un compte bloqué n'est pas « presque actif »."""
    Enrollment.objects.filter(pk=inscription.pk).update(status=statut)

    assert client_etudiante.get(f"/api/chapters/{chapitre_payant.slug}").status_code == 404


def test_l_inscription_d_un_autre_compte_n_ouvre_rien(
    api_client: APIClient,
    etudiant_b: User,
    etudiante: User,
    inscription: Enrollment,
    chapitre_payant: Chapter,
) -> None:
    """Checklist point 1 : l'accès se lit sur l'inscription de l'appelant, pas d'un autre."""
    from apps.enrollment.tests.conftest import connecter

    _activer(etudiante)
    client_b = connecter(api_client, etudiant_b)
    cours = chapitre_payant.module.course

    assert client_b.get(f"/api/chapters/{chapitre_payant.slug}").status_code == 404
    assert a_acces_au_contenu(etudiant_b, cours) is False
    assert a_acces_au_contenu(etudiante, cours) is True


def test_un_chapitre_d_un_cours_non_publie_reste_invisible(
    client_etudiante: APIClient, inscription: Enrollment, chapitre_payant: Chapter, etudiante: User
) -> None:
    _activer(etudiante)
    cours = chapitre_payant.module.course
    cours.is_published = False
    cours.save(update_fields=["is_published"])

    assert client_etudiante.get(f"/api/chapters/{chapitre_payant.slug}").status_code == 404


# --- Route publique --------------------------------------------------------


def test_la_route_publique_ne_sert_jamais_un_chapitre_payant(
    api_client: APIClient, chapitre_payant: Chapter
) -> None:
    reponse = api_client.get(f"/api/public/chapters/{chapitre_payant.slug}")

    assert reponse.status_code == 404


def test_un_compte_actif_ne_deverrouille_pas_la_route_publique(
    client_etudiante: APIClient, inscription: Enrollment, chapitre_payant: Chapter, etudiante: User
) -> None:
    """La route publique reste publique : elle ne regarde pas qui appelle."""
    _activer(etudiante)

    assert client_etudiante.get(f"/api/public/chapters/{chapitre_payant.slug}").status_code == 404


def test_l_arbre_public_du_cours_ne_contient_aucun_contenu_de_lecon(
    api_client: APIClient, chapitre_payant: Chapter, chapitre_gratuit: Chapter
) -> None:
    """Checklist point 2 : la structure oui, le contenu jamais (§4.4)."""
    reponse = api_client.get("/api/public/course/flutter-firebase-debutants")
    corps = reponse.content.decode()

    assert reponse.status_code == 200
    assert chapitre_payant.title in corps  # le titre fait partie du programme affiché
    assert "transcript" not in corps
    assert "video_provider_id" not in corps
    assert "réservé aux inscrits actifs" not in corps

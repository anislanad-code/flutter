"""Invariantes de CLAUDE.md §4 devenues exigibles à l'étape 2.

`apps/accounts/tests/test_invariantes.py` posait des sentinelles statiques tant que le
catalogue n'existait pas. Maintenant qu'il existe, on les rejoue sur des réponses HTTP
réelles : un compte `PENDING` face à un chapitre payant, et le contenu exact qui sort
des trois endpoints publics.
"""

from __future__ import annotations

import re
from typing import cast

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course, Lesson, Module

pytestmark = pytest.mark.django_db

MOT_DE_PASSE = "un-mot-de-passe-solide-123"
# Toute forme de fichier vidéo directement rejouable, quel que soit l'hébergeur (§4.1.1).
MOTIF_VIDEO_BRUTE = re.compile(
    r"\.(mp4|m3u8|mkv|webm|mov)\b|b-cdn\.net|bunnycdn\.com|iframe\.mediadelivery\.net",
    re.IGNORECASE,
)


@pytest.fixture
def client_pending(api_client: APIClient) -> APIClient:
    """Un compte fraîchement inscrit : `Enrollment` en `PENDING`, connecté."""
    utilisateur = cast(
        User,
        User.objects.create_user(
            email="pending@example.com", phone="0555111222", password=MOT_DE_PASSE
        ),
    )
    connexion = api_client.post(
        "/api/auth/login",
        {"email": utilisateur.email, "password": MOT_DE_PASSE},
        format="json",
    )
    assert connexion.status_code == 200
    api_client.cookies["access_token"] = connexion.data["access_token"]
    return api_client


def test_un_compte_pending_n_obtient_que_le_chapitre_gratuit(
    client_pending: APIClient, chapitre_gratuit: Chapter, chapitre_payant: Chapter
) -> None:
    """§4.4 — le chapitre `is_free` est le SEUL contenu accessible sans inscription active."""
    libre = client_pending.get(f"/api/public/chapters/{chapitre_gratuit.slug}")
    payant = client_pending.get(f"/api/public/chapters/{chapitre_payant.slug}")

    assert libre.status_code == 200
    assert payant.status_code == 404, "un compte PENDING a atteint un chapitre payant"


def test_un_compte_pending_ne_gagne_rien_par_rapport_a_un_visiteur_anonyme(
    api_client: APIClient, client_pending: APIClient, chapitre_gratuit: Chapter, cours: Course
) -> None:
    """Le cookie ne doit ouvrir aucune porte supplémentaire sur les routes publiques."""
    anonyme = APIClient()

    for chemin in [
        f"/api/public/course/{cours.slug}",
        f"/api/public/chapters/{chapitre_gratuit.slug}",
    ]:
        assert anonyme.get(chemin).json() == client_pending.get(chemin).json()


def test_l_exception_au_paywall_suit_le_flag_pas_un_identifiant_code_en_dur(
    api_client: APIClient, cours: Course
) -> None:
    """§4.4 — un chapitre gratuit ailleurs que Module 0 / Chapitre 1 doit s'ouvrir aussi,
    et le Module 0 / Chapitre 1 doit se fermer si son flag tombe.
    """
    module_0 = Module.objects.create(course=cours, order=0, title="Mise en route")
    premier = Chapter.objects.create(
        module=module_0, slug="premier", order=1, title="Premier", is_free=False
    )
    Lesson.objects.create(chapter=premier, transcript="Fermé.")

    module_3 = Module.objects.create(course=cours, order=3, title="Firebase")
    tardif = Chapter.objects.create(
        module=module_3, slug="tardif", order=7, title="Tardif", is_free=True
    )
    Lesson.objects.create(chapter=tardif, transcript="Ouvert.")

    assert api_client.get(f"/api/public/chapters/{premier.slug}").status_code == 404
    assert api_client.get(f"/api/public/chapters/{tardif.slug}").status_code == 200


def test_aucune_reponse_publique_ne_contient_d_url_de_fichier_video_brute(
    api_client: APIClient, cours: Course, chapitre_gratuit: Chapter, chapitre_payant: Chapter
) -> None:
    """§4.1.1 — même sur le chapitre gratuit, aucune URL de média rejouable ne sort."""
    lecon = chapitre_gratuit.lesson
    lecon.video_provider_id = "12345-abcde"
    lecon.save(update_fields=["video_provider_id"])

    reponses = [
        api_client.get(f"/api/public/course/{cours.slug}"),
        api_client.get(f"/api/public/chapters/{chapitre_gratuit.slug}"),
        api_client.post("/api/public/leads", {"email": "a@b.co", "form_rendered_at": 0}),
    ]

    for reponse in reponses:
        corps = reponse.content.decode(errors="ignore")
        assert not MOTIF_VIDEO_BRUTE.search(corps), f"URL vidéo brute dans {corps[:200]}"


def test_aucune_reponse_publique_n_expose_is_correct_ni_de_champ_interne(
    api_client: APIClient, cours: Course, chapitre_gratuit: Chapter
) -> None:
    """§4.4 et §4.3 — rejeu à chaque étape, ici sur les réponses réelles."""
    for chemin in [
        f"/api/public/course/{cours.slug}",
        f"/api/public/chapters/{chapitre_gratuit.slug}",
    ]:
        corps = api_client.get(chemin).content.decode()
        for interdit in ["is_correct", "is_published", "password", "created_at", "flagged"]:
            assert interdit not in corps, f"{chemin} expose {interdit}"


def test_le_404_d_un_chapitre_payant_est_identique_a_celui_d_un_chapitre_inexistant(
    api_client: APIClient, chapitre_payant: Chapter
) -> None:
    """§4.3 — ne jamais confirmer l'existence d'une ressource par la forme de l'erreur."""
    payant = api_client.get(f"/api/public/chapters/{chapitre_payant.slug}")
    fantome = api_client.get("/api/public/chapters/ce-slug-n-existe-pas")

    assert payant.status_code == fantome.status_code == 404
    assert payant.json() == fantome.json()


def test_le_404_d_un_chapitre_de_cours_non_publie_est_identique_a_celui_d_un_inexistant(
    api_client: APIClient, cours_non_publie: Course
) -> None:
    """§4.3 — un cours en préparation ne doit pas être découvrable par différence de
    message d'erreur. C'est le cas d'exploitation réel : les slugs des chapitres d'un
    cours publié sont de toute façon dans l'arbre public, ceux d'un brouillon non.
    """
    module = Module.objects.create(course=cours_non_publie, order=0, title="Mise en route")
    Chapter.objects.create(
        module=module, slug="secret-en-preparation", order=1, title="Secret", is_free=True
    )

    existant = api_client.get("/api/public/chapters/secret-en-preparation")
    fantome = api_client.get("/api/public/chapters/secret-en-preparation-xyz")

    assert existant.status_code == fantome.status_code == 404
    assert existant.json() == fantome.json(), (
        "le corps du 404 distingue un slug existant d'un slug inexistant : "
        "un brouillon devient énumérable"
    )


def test_django_ne_pose_jamais_lui_meme_un_cookie_de_session(api_client: APIClient) -> None:
    """§4.2 — les trois drapeaux (httpOnly, Secure, SameSite=Strict) sont posés par le BFF
    Next, qui est le seul à écrire des cookies (vérifié côté front dans
    `web/tests/invariantes-cookies.test.ts`). Le pendant côté Django, c'est qu'il n'en
    pose aucun : un cookie émis ici échapperait à ces drapeaux.
    """
    User.objects.create_user(email="c@example.com", phone="0555000000", password=MOT_DE_PASSE)
    reponse = api_client.post(
        "/api/auth/login", {"email": "c@example.com", "password": MOT_DE_PASSE}, format="json"
    )

    assert reponse.status_code == 200
    assert reponse.data["access_token"]
    assert not reponse.cookies, f"Django pose des cookies : {list(reponse.cookies)}"


def test_l_arbre_public_respecte_l_ordre_declare(api_client: APIClient, cours: Course) -> None:
    """Le front n'a aucune logique de tri : l'ordre vient du serveur (§7)."""
    for ordre in [2, 0, 1]:
        module = Module.objects.create(course=cours, order=ordre, title=f"M{ordre}")
        for chapitre_ordre in [3, 1, 2]:
            Chapter.objects.create(
                module=module,
                slug=f"m{ordre}-c{chapitre_ordre}",
                order=chapitre_ordre,
                title=f"C{chapitre_ordre}",
            )

    corps = api_client.get(f"/api/public/course/{cours.slug}").json()

    assert [m["order"] for m in corps["modules"]] == [0, 1, 2]
    for module in corps["modules"]:
        assert [c["order"] for c in module["chapters"]] == [1, 2, 3]


def test_un_cours_depublie_referme_son_chapitre_gratuit(
    api_client: APIClient, cours: Course, chapitre_gratuit: Chapter
) -> None:
    """Cas limite d'exploitation : dépublier doit fermer le contenu, pas seulement l'arbre."""
    assert api_client.get(f"/api/public/chapters/{chapitre_gratuit.slug}").status_code == 200

    Course.objects.filter(pk=cours.pk).update(is_published=False)

    assert api_client.get(f"/api/public/chapters/{chapitre_gratuit.slug}").status_code == 404
    assert api_client.get(f"/api/public/course/{cours.slug}").status_code == 404


def test_un_chapitre_gratuit_sans_lecon_ne_plante_pas(api_client: APIClient, cours: Course) -> None:
    """Contenu partiellement saisi en back-office : 200 avec `lesson` nulle, jamais 500."""
    module = Module.objects.create(course=cours, order=0, title="Mise en route")
    chapitre = Chapter.objects.create(
        module=module, slug="sans-lecon", order=1, title="Sans leçon", is_free=True
    )

    reponse = api_client.get(f"/api/public/chapters/{chapitre.slug}")

    assert reponse.status_code == 200
    assert reponse.json()["lesson"] is None

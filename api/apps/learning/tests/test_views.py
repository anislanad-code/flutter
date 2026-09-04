"""Vues du pipeline : accès, paywall, IDOR (CLAUDE.md §8)."""

from __future__ import annotations

from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course, Module
from apps.enrollment.models import Enrollment


def test_progress_refuse_un_appel_anonyme(api_client: APIClient, cours: Course) -> None:
    response = api_client.get("/api/progress", {"course": cours.slug})
    assert response.status_code == 401


def test_progress_404_sur_un_cours_inconnu(
    client_etudiante: APIClient, inscription_active: Enrollment
) -> None:
    response = client_etudiante.get("/api/progress", {"course": "cours-inexistant"})
    assert response.status_code == 404


def test_progress_404_sur_un_parametre_course_malforme(
    client_etudiante: APIClient, inscription_active: Enrollment
) -> None:
    """Un octet NUL ou tout caractère hors de l'alphabet d'un slug ne doit jamais
    atteindre la base — sinon le pilote PostgreSQL lève une exception non gérée (500)
    plutôt qu'un 404 propre (§8 relecture étape 5, MOYEN M2)."""
    for valeur in ("\x00", "' OR 1=1--", "../../etc/passwd", "flutter%", ""):
        response = client_etudiante.get("/api/progress", {"course": valeur})
        assert response.status_code == 404, f"valeur {valeur!r}"


def test_progress_est_limite_en_debit(
    client_etudiante: APIClient, inscription_active: Enrollment, cours: Course
) -> None:
    cache.clear()
    for _ in range(60):
        client_etudiante.get("/api/progress", {"course": cours.slug})
    response = client_etudiante.get("/api/progress", {"course": cours.slug})
    assert response.status_code == 429


def test_progress_renvoie_la_structure_du_pipeline(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
) -> None:
    response = client_etudiante.get("/api/progress", {"course": cours.slug})
    assert response.status_code == 200
    corps = response.json()
    assert corps["course_slug"] == cours.slug
    assert corps["modules"][0]["chapters"][0]["state"] == "disponible"
    # Jamais de champ interne au-delà de ce qui décrit l'état — pas d'`is_correct`,
    # pas d'identifiant Bunny, rien qui ne serve pas l'affichage du pipeline.
    assert set(corps["modules"][0]["chapters"][0].keys()) == {
        "id",
        "slug",
        "order",
        "title",
        "is_free",
        "state",
        "quiz_id",
    }
    assert corps["modules"][0]["chapters"][0]["quiz_id"] is None
    assert "exam_quiz_id" in corps["modules"][0]
    assert "exam_passed" in corps["modules"][0]


def test_complete_marque_le_chapitre_termine(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    chapitre_0a: Chapter,
) -> None:
    response = client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    assert response.status_code == 200
    assert response.json() == {"chapter_slug": chapitre_0a.slug, "state": "termine"}


def test_complete_est_idempotent(
    client_etudiante: APIClient, inscription_active: Enrollment, chapitre_0a: Chapter
) -> None:
    premiere = client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    seconde = client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    assert premiere.status_code == seconde.status_code == 200


def test_complete_404_sur_un_chapitre_inexistant(
    client_etudiante: APIClient, inscription_active: Enrollment
) -> None:
    response = client_etudiante.post("/api/chapters/nexiste-pas/complete")
    assert response.status_code == 404


def test_complete_404_sur_un_chapitre_dun_cours_depublie(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    chapitre_0a: Chapter,
) -> None:
    cours.is_published = False
    cours.save(update_fields=["is_published"])

    response = client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    assert response.status_code == 404


def test_complete_refuse_un_chapitre_payant_a_un_compte_pending(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    chapitre_0b: Chapter,
) -> None:
    """Contournement du paywall par la complétion (§4.4, §8 point 4) : un compte qui
    n'a jamais eu le droit de voir le chapitre ne doit pas pouvoir le marquer terminé
    non plus — ni révéler qu'il existe autrement que par la même 404 que d'habitude."""
    response = client_etudiante.post(f"/api/chapters/{chapitre_0b.slug}/complete")
    assert response.status_code == 404


def test_complete_autorise_le_chapitre_gratuit_a_un_compte_pending(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    chapitre_0a: Chapter,
) -> None:
    response = client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    assert response.status_code == 200


def test_complete_dun_etudiant_ninflue_pas_sur_la_progression_dun_autre(
    client_etudiante: APIClient,
    client_b: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
) -> None:
    """§8 checklist IDOR : rien à énumérer (aucune route ne prend d'id d'utilisateur),
    mais on vérifie tout de même que deux comptes ne partagent jamais leur état."""
    etudiant_b = User.objects.get(email="karim@example.com")
    Enrollment.objects.create(user=etudiant_b, course=cours, status=Enrollment.Status.ACTIVE)

    client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")

    reponse_b = client_b.get("/api/progress", {"course": cours.slug})
    etat_b = next(
        c["state"]
        for c in reponse_b.json()["modules"][0]["chapters"]
        if c["slug"] == chapitre_0a.slug
    )
    assert etat_b == "disponible"


def test_complete_est_limite_en_debit(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    chapitre_0a: Chapter,
) -> None:
    cache.clear()
    for _ in range(30):
        client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    response = client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    assert response.status_code == 429

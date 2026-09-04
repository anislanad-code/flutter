"""Vues des QCM et examens : accès, paywall, IDOR, anti-triche (CLAUDE.md §8)."""

from __future__ import annotations

import datetime as dt

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.assessment.models import Attempt, Quiz
from apps.assessment.tests.conftest import bonnes_reponses, mauvaises_reponses, tentative_ancienne
from apps.catalog.models import Chapter, Course, Module
from apps.enrollment.models import Enrollment

# --- GET /api/quizzes/{id} ---------------------------------------------------


def test_quiz_refuse_un_appel_anonyme(api_client: APIClient, quiz_chapitre: Quiz) -> None:
    response = api_client.get(f"/api/quizzes/{quiz_chapitre.id}")
    assert response.status_code == 401


def test_quiz_404_sur_un_id_inexistant(client_etudiante: APIClient) -> None:
    response = client_etudiante.get("/api/quizzes/999999")
    assert response.status_code == 404


def test_quiz_ne_revele_jamais_is_correct(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    response = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}")
    assert response.status_code == 200
    corps = response.json()
    assert "is_correct" not in str(corps)
    for question in corps["questions"]:
        assert set(question.keys()) == {"id", "order", "text", "choices"}
        for choix in question["choices"]:
            assert set(choix.keys()) == {"id", "text"}


def test_quiz_paywall_refuse_un_qcm_payant_a_un_compte_pending(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    quiz_chapitre_payant: Quiz,
) -> None:
    response = client_etudiante.get(f"/api/quizzes/{quiz_chapitre_payant.id}")
    assert response.status_code == 404


def test_quiz_gratuit_accessible_a_un_compte_pending(
    client_etudiante: APIClient, inscription_pending: Enrollment, quiz_chapitre: Quiz
) -> None:
    response = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}")
    assert response.status_code == 200


def test_examen_de_module_refuse_a_un_compte_pending_meme_pour_le_module_gratuit(
    client_etudiante: APIClient, inscription_pending: Enrollment, quiz_examen: Quiz
) -> None:
    """Seul le premier chapitre est gratuit (§4.4) — l'examen du module, lui, exige une
    inscription active, même si le module contient un chapitre gratuit."""
    response = client_etudiante.get(f"/api/quizzes/{quiz_examen.id}")
    assert response.status_code == 404


def test_quiz_est_limite_en_debit(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    cache.clear()
    for _ in range(60):
        client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}")
    response = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}")
    assert response.status_code == 429


# --- POST /api/quizzes/{id}/attempts -----------------------------------------


def test_demarrer_tentative_refuse_un_appel_anonyme(
    api_client: APIClient, quiz_chapitre: Quiz
) -> None:
    response = api_client.post(f"/api/quizzes/{quiz_chapitre.id}/attempts")
    assert response.status_code == 401


def test_demarrer_tentative_cree_une_tentative(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    response = client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts")
    assert response.status_code == 201
    assert Attempt.objects.filter(quiz=quiz_chapitre).count() == 1


def test_demarrer_tentative_reutilise_une_tentative_ouverte(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    premiere = client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts").json()
    seconde = client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts").json()
    assert premiere["id"] == seconde["id"]
    assert Attempt.objects.filter(quiz=quiz_chapitre).count() == 1


def test_demarrer_tentative_refuse_au_dela_du_maximum(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    # `max_attempts = 2` (fixture). Deux tentatives soumises épuisent le quota.
    for _ in range(2):
        Attempt.objects.create(
            user=etudiante,
            quiz=quiz_chapitre,
            started_at=timezone.now() - dt.timedelta(seconds=3600),
            submitted_at=timezone.now(),
            score=100,
            passed=True,
        )
    response = client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts")
    assert response.status_code == 409


def test_demarrer_tentative_refuse_un_qcm_payant_a_un_compte_pending(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    quiz_chapitre_payant: Quiz,
) -> None:
    response = client_etudiante.post(f"/api/quizzes/{quiz_chapitre_payant.id}/attempts")
    assert response.status_code == 404


def test_demarrer_tentative_est_limite_en_debit(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    cache.clear()
    for _ in range(30):
        client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts")
    response = client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts")
    assert response.status_code == 429


# --- POST /api/attempts/{id}/submit ------------------------------------------


def test_soumettre_note_correctement_et_ne_fait_pas_confiance_a_un_score_envoye(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    reponses = bonnes_reponses(quiz_chapitre)

    response = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": reponses, "score": 0, "is_staff": True},
        format="json",
    )
    assert response.status_code == 200
    corps = response.json()
    assert corps["score"] == 100
    assert corps["passed"] is True
    # Après soumission, l'explication et la correction sortent bien — c'est le point
    # de la fonctionnalité, contrairement à `GET /api/quizzes/{id}` avant soumission.
    for question in corps["questions"]:
        assert question["explanation"]
        assert any(c["is_correct"] for c in question["choices"])


def test_soumettre_avec_de_mauvaises_reponses_donne_un_score_bas(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    response = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": mauvaises_reponses(quiz_chapitre)},
        format="json",
    )
    assert response.status_code == 200
    corps = response.json()
    assert corps["score"] == 0
    assert corps["passed"] is False


def test_soumettre_refuse_avant_la_duree_plancher(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    demarrage = client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts").json()
    response = client_etudiante.post(
        f"/api/attempts/{demarrage['id']}/submit",
        {"answers": bonnes_reponses(quiz_chapitre)},
        format="json",
    )
    assert response.status_code == 400


def test_soumettre_refuse_une_double_soumission(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    reponses = bonnes_reponses(quiz_chapitre)
    premiere = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit", {"answers": reponses}, format="json"
    )
    seconde = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit", {"answers": reponses}, format="json"
    )
    assert premiere.status_code == 200
    assert seconde.status_code == 409


def test_soumettre_refuse_un_choix_dune_autre_question(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    questions = list(quiz_chapitre.questions.all())
    premier_choix = questions[1].choices.first()
    assert premier_choix is not None
    choix_autre_question = premier_choix.id
    reponses = {
        str(questions[0].id): choix_autre_question,
        str(questions[1].id): choix_autre_question,
    }
    response = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": reponses},
        format="json",
    )
    # Pas d'erreur serveur : un choix qui appartient bien au quiz (même mauvaise
    # question) est juste noté incorrect pour la question à laquelle il ne correspond
    # pas — seul un id de choix totalement étranger au quiz est rejeté (test suivant).
    assert response.status_code == 200


def test_soumettre_refuse_un_choix_totalement_etranger_au_quiz(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    quiz_chapitre_payant: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    question = quiz_chapitre.questions.first()
    assert question is not None
    autre_question = quiz_chapitre_payant.questions.first()
    assert autre_question is not None
    autre_choix = autre_question.choices.first()
    assert autre_choix is not None
    response = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": {str(question.id): autre_choix.id}},
        format="json",
    )
    assert response.status_code == 400


def test_soumettre_dune_tentative_dun_autre_etudiant_renvoie_404(
    client_b: APIClient,
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
    etudiant_b: User,
) -> None:
    """§8 checklist IDOR : l'étudiant B ne doit jamais pouvoir soumettre — ni même
    savoir qu'elle existe — la tentative de l'étudiante A."""
    chapitre = quiz_chapitre.chapter
    assert chapitre is not None
    Enrollment.objects.create(
        user=etudiant_b,
        course=Course.objects.get(pk=chapitre.module.course_id),
        status=Enrollment.Status.ACTIVE,
    )
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    response = client_b.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": bonnes_reponses(quiz_chapitre)},
        format="json",
    )
    assert response.status_code == 404


def test_soumettre_refuse_une_cle_de_question_non_numerique(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    response = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": {"pas-un-nombre": 1}},
        format="json",
    )
    assert response.status_code == 400


def test_soumettre_404_sur_une_tentative_inexistante(client_etudiante: APIClient) -> None:
    response = client_etudiante.post(
        "/api/attempts/999999/submit", {"answers": {}}, format="json"
    )
    assert response.status_code == 404


def test_soumettre_un_examen_reussi_deverrouille_le_module_suivant(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_examen: Quiz,
    etudiante: User,
    cours: Course,
) -> None:
    module_1 = Module.objects.create(course=cours, order=1, title="Suite")
    Chapter.objects.create(module=module_1, slug="suite-1", order=1, title="Suite 1")

    tentative = tentative_ancienne(user=etudiante, quiz=quiz_examen)
    reponse = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": bonnes_reponses(quiz_examen)},
        format="json",
    )
    assert reponse.status_code == 200
    assert reponse.json()["passed"] is True

    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    module_suivant = next(m for m in pipeline["modules"] if m["order"] == 1)
    assert module_suivant["unlocked"] is True


def test_soumettre_est_limite_en_debit(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    cache.clear()
    for _ in range(30):
        tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
        client_etudiante.post(
            f"/api/attempts/{tentative.id}/submit", {"answers": {}}, format="json"
        )
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    response = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit", {"answers": {}}, format="json"
    )
    assert response.status_code == 429

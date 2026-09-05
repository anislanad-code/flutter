"""Cloisonnement des QCM : paywall, IDOR, fuite de contenu (CLAUDE.md §4.3, §4.4, §8).

Les tests de `test_views.py` couvrent le paywall « compte `PENDING` sur la même
formation ». Ce fichier attaque les chemins qu'il laissait ouverts :

- une inscription active sur **une autre formation** (l'ÉLEVÉ E1 de l'étape 5, rejoué
  sur ce nouveau point d'API) ;
- un compte **sans aucune inscription** ;
- un quiz d'une formation **dépubliée** (invariante posée aux étapes 2 et 5) ;
- l'indistinguabilité entre « n'existe pas » et « pas pour toi » (pas d'oracle) ;
- l'absence de `is_correct`, d'`explanation` et d'URL de fichier vidéo dans toute
  réponse antérieure à la soumission ;
- l'isolation des tentatives et des `ModuleCompletion` entre deux comptes.
"""

from __future__ import annotations

from typing import Any

from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.assessment.models import Attempt, Quiz
from apps.assessment.tests.conftest import bonnes_reponses, tentative_ancienne
from apps.catalog.models import Chapter, Course, Lesson, Module
from apps.enrollment.models import Enrollment
from apps.learning.models import ModuleCompletion


def _autre_formation_avec_quiz() -> tuple[Course, Quiz, Quiz]:
    """Une seconde formation publiée, avec un QCM de chapitre payant et un examen."""
    cours = Course.objects.create(
        slug="dart-avance", title="Dart avancé", description="Autre.", is_published=True
    )
    module = Module.objects.create(course=cours, order=0, title="Fondations")
    chapitre = Chapter.objects.create(
        module=module, slug="isolats", order=1, title="Isolats", is_free=False
    )
    Lesson.objects.create(chapter=chapitre, duration_s=300, transcript="Payant ailleurs.")
    quiz_chap = Quiz.objects.create(chapter=chapitre, min_duration_s=0)
    quiz_exam = Quiz.objects.create(module=module, min_duration_s=0)
    return cours, quiz_chap, quiz_exam


# --- Paywall par formation ---------------------------------------------------


def test_une_inscription_active_sur_une_formation_nouvre_aucun_quiz_dune_autre(
    client_etudiante: APIClient, inscription_active: Enrollment
) -> None:
    """§4.4 et étape 5 (ÉLEVÉ E1) : le paywall est scopé par `(user, course)`."""
    _, quiz_chap, quiz_exam = _autre_formation_avec_quiz()

    for quiz in (quiz_chap, quiz_exam):
        assert client_etudiante.get(f"/api/quizzes/{quiz.id}").status_code == 404
        assert client_etudiante.post(f"/api/quizzes/{quiz.id}/attempts").status_code == 404

    assert Attempt.objects.count() == 0


def test_un_compte_sans_aucune_inscription_nobtient_pas_un_quiz_payant(
    client_etudiante: APIClient, quiz_chapitre_payant: Quiz
) -> None:
    assert Enrollment.objects.count() == 0
    assert client_etudiante.get(f"/api/quizzes/{quiz_chapitre_payant.id}").status_code == 404
    assert (
        client_etudiante.post(f"/api/quizzes/{quiz_chapitre_payant.id}/attempts").status_code == 404
    )


def test_un_compte_sans_aucune_inscription_obtient_le_quiz_du_chapitre_gratuit(
    client_etudiante: APIClient, quiz_chapitre: Quiz
) -> None:
    """L'exception `is_free` du §4.4 vaut aussi pour le QCM du chapitre gratuit —
    sinon la démonstration s'arrête au milieu du chapitre d'appel."""
    assert client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}").status_code == 200
    assert client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts").status_code == 201


def test_un_compte_bloque_perd_lacces_au_quiz_payant(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre_payant: Quiz,
) -> None:
    inscription_active.status = Enrollment.Status.BLOCKED
    inscription_active.save(update_fields=["status"])

    assert client_etudiante.get(f"/api/quizzes/{quiz_chapitre_payant.id}").status_code == 404


def test_le_quiz_dune_formation_depubliee_nest_pas_servi(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    quiz_chapitre_payant: Quiz,
    quiz_examen: Quiz,
    cours: Course,
) -> None:
    """Invariante posée à l'étape 2 et rejouée à l'étape 5 : une formation dépubliée
    n'expose plus rien — ni sa structure, ni un chapitre, ni sa progression, ni un
    jeton de lecture (`catalog/views.py:63,93`, `learning/views.py:51,81`,
    `media/services.py:77`). Le QCM est du contenu de formation comme le reste :
    `a_acces_au_quiz` doit refuser un quiz dont la formation n'est pas publiée, sur les
    deux branches — QCM de chapitre **et** examen de module."""
    cours.is_published = False
    cours.save(update_fields=["is_published"])

    statuts = {
        "GET quiz du chapitre gratuit": client_etudiante.get(
            f"/api/quizzes/{quiz_chapitre.id}"
        ).status_code,
        "POST tentative sur le chapitre gratuit": client_etudiante.post(
            f"/api/quizzes/{quiz_chapitre.id}/attempts"
        ).status_code,
        "GET quiz du chapitre payant": client_etudiante.get(
            f"/api/quizzes/{quiz_chapitre_payant.id}"
        ).status_code,
        "GET examen de module": client_etudiante.get(f"/api/quizzes/{quiz_examen.id}").status_code,
        "POST tentative d'examen": client_etudiante.post(
            f"/api/quizzes/{quiz_examen.id}/attempts"
        ).status_code,
    }

    assert set(statuts.values()) == {404}, statuts


def test_le_quiz_gratuit_dune_formation_depubliee_nest_pas_servi_sans_inscription(
    client_etudiante: APIClient, quiz_chapitre: Quiz, cours: Course
) -> None:
    """Pire cas du précédent : sans aucune inscription, `is_free` suffit à ouvrir le
    QCM — donc le contenu d'une formation encore en préparation sort dès qu'un compte
    quelconque devine un identifiant (auto-incrément)."""
    cours.is_published = False
    cours.save(update_fields=["is_published"])

    assert client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}").status_code == 404


# --- Pas d'oracle ------------------------------------------------------------


def test_un_quiz_interdit_est_indiscernable_dun_quiz_inexistant(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    quiz_chapitre_payant: Quiz,
) -> None:
    """§4.3 : 404 pour les deux, et le *même corps* — sinon le code d'erreur suffit à
    confirmer l'existence de la ressource."""
    interdit = client_etudiante.get(f"/api/quizzes/{quiz_chapitre_payant.id}")
    inexistant = client_etudiante.get("/api/quizzes/987654")

    assert interdit.status_code == inexistant.status_code == 404
    assert interdit.json() == inexistant.json()


def test_une_tentative_dun_tiers_est_indiscernable_dune_tentative_inexistante(
    client_b: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    tiers = client_b.post(f"/api/attempts/{tentative.id}/submit", {"answers": {}}, format="json")
    inexistante = client_b.post("/api/attempts/987654/submit", {"answers": {}}, format="json")

    assert tiers.status_code == inexistante.status_code == 404
    assert tiers.json() == inexistante.json()


# --- IDOR --------------------------------------------------------------------


def test_soumettre_refuse_un_appel_anonyme(api_client: APIClient, quiz_chapitre: Quiz) -> None:
    reponse = api_client.post("/api/attempts/1/submit", {"answers": {}}, format="json")
    assert reponse.status_code == 401


def test_la_tentative_dun_tiers_reste_intacte_apres_une_tentative_didor(
    client_b: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
    etudiant_b: User,
    cours: Course,
) -> None:
    Enrollment.objects.create(user=etudiant_b, course=cours, status=Enrollment.Status.ACTIVE)
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = client_b.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": {str(k): v for k, v in bonnes_reponses(quiz_chapitre).items()}},
        format="json",
    )

    assert reponse.status_code == 404
    tentative.refresh_from_db()
    assert tentative.submitted_at is None
    assert tentative.score is None


def test_letat_dun_quiz_ne_melange_jamais_les_tentatives_de_deux_comptes(
    client_etudiante: APIClient,
    client_b: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
    etudiant_b: User,
    cours: Course,
) -> None:
    Enrollment.objects.create(user=etudiant_b, course=cours, status=Enrollment.Status.ACTIVE)
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": {str(k): v for k, v in bonnes_reponses(quiz_chapitre).items()}},
        format="json",
    )

    etat_b = client_b.get(f"/api/quizzes/{quiz_chapitre.id}").json()

    assert etat_b["attempts_used"] == 0
    assert etat_b["best_score"] is None
    assert etat_b["attempts_remaining"] == quiz_chapitre.max_attempts


def test_un_examen_reussi_par_un_compte_ne_deverrouille_rien_pour_lautre(
    client_b: APIClient,
    inscription_active: Enrollment,
    quiz_examen: Quiz,
    etudiante: User,
    etudiant_b: User,
    cours: Course,
) -> None:
    Enrollment.objects.create(user=etudiant_b, course=cours, status=Enrollment.Status.ACTIVE)
    tentative = tentative_ancienne(user=etudiant_b, quiz=quiz_examen)
    client_b.post(
        f"/api/attempts/{tentative.id}/submit",
        {"answers": {str(k): v for k, v in bonnes_reponses(quiz_examen).items()}},
        format="json",
    )

    assert ModuleCompletion.objects.filter(user=etudiant_b, exam_passed=True).exists()
    assert not ModuleCompletion.objects.filter(user=etudiante).exists()


# --- Fuite de contenu --------------------------------------------------------


def _reponses_avant_soumission(client: APIClient, quiz: Quiz) -> list[Any]:
    return [
        client.get(f"/api/quizzes/{quiz.id}"),
        client.post(f"/api/quizzes/{quiz.id}/attempts"),
    ]


def test_aucune_reponse_anterieure_a_la_soumission_ne_porte_is_correct(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    for reponse in _reponses_avant_soumission(client_etudiante, quiz_chapitre):
        assert reponse.status_code in (200, 201)
        assert "is_correct" not in reponse.content.decode()


def test_aucune_reponse_anterieure_a_la_soumission_ne_porte_dexplication(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    """L'explication révèle la bonne réponse aussi sûrement qu'`is_correct`."""
    for reponse in _reponses_avant_soumission(client_etudiante, quiz_chapitre):
        corps = reponse.content.decode()
        assert "explanation" not in corps
        assert "Explication" not in corps


def test_aucune_reponse_de_letape_ne_porte_durl_de_fichier_video(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    """§4.1.1 — rejouée à chaque étape."""
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    reponses = [
        *_reponses_avant_soumission(client_etudiante, quiz_chapitre),
        client_etudiante.post(
            f"/api/attempts/{tentative.id}/submit",
            {"answers": {str(k): v for k, v in bonnes_reponses(quiz_chapitre).items()}},
            format="json",
        ),
    ]

    for reponse in reponses:
        corps = reponse.content.decode().lower()
        for interdit in (".mp4", ".m3u8", "b-cdn.net", "video_provider_id", "bcdn_token"):
            assert interdit not in corps


def test_letat_dun_quiz_nexpose_aucun_champ_interne(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    corps = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}").json()

    assert set(corps) == {
        "id",
        "kind",
        "pass_threshold",
        "max_attempts",
        "min_duration_s",
        "attempts_used",
        "attempts_remaining",
        "best_score",
        "questions",
    }
    # Ni l'id du chapitre, ni celui du module : le quiz ne sert pas de carte du contenu.
    assert "chapter" not in corps
    assert "module" not in corps


def test_un_texte_hostile_dans_une_question_ressort_tel_quel_en_json_jamais_interprete(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
) -> None:
    """§8 point 8 : le stockage n'échappe rien (c'est le rôle du rendu), mais l'API ne
    doit pas non plus fabriquer de HTML — la charge doit ressortir comme du texte JSON,
    et jamais dans un en-tête `Content-Type` autre que `application/json`."""
    charge = "<script>alert('xss')</script>"
    question = quiz_chapitre.questions.first()
    assert question is not None
    question.text = charge
    question.save(update_fields=["text"])

    reponse = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}")

    assert reponse["Content-Type"].startswith("application/json")
    textes = [q["text"] for q in reponse.json()["questions"]]
    assert charge in textes

"""Anti-triche des QCM et intégrité de la correction (CLAUDE.md §4.4, §8 point 3).

Ce que ce fichier établit, et qu'aucun autre test ne couvrait :

- la **durée plancher** à la seconde près (accepté à `min_duration_s`, refusé juste
  avant) et le fait qu'un refus ne consomme **aucune** tentative ;
- le **quota** : une tentative ouverte ne compte pas, une tentative soumise oui, un
  quota à zéro refuse d'emblée, et l'état renvoyé par l'API dit la vérité ;
- la **double soumission** : la seconde est refusée *et* n'écrase pas la première ;
- l'**atomicité** : une soumission rejetée en cours de route ne laisse aucun effet
  partiel (ni `submitted_at`, ni `score`, ni `ModuleCompletion`) ;
- le **score** : aucun champ du corps de la requête ne l'influence, et aucun champ
  d'escalade de privilège n'est accepté ;
- les **réponses malformées** : identifiant de question négatif, `answers` absent ou
  de la mauvaise forme, choix appartenant à un autre quiz ;
- les **cas limites de barème** : quiz sans question, seuil à zéro, réponses
  partielles, question sans bonne réponse.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.assessment.models import Attempt, Choice, Question, Quiz
from apps.assessment.tests.conftest import (
    bonnes_reponses,
    mauvaises_reponses,
    tentative_ancienne,
)
from apps.enrollment.models import Enrollment
from apps.learning.models import ModuleCompletion


def _soumettre(client: APIClient, tentative_id: int, answers: dict[str, int]) -> Any:
    return client.post(f"/api/attempts/{tentative_id}/submit", {"answers": answers}, format="json")


def _en_chaines(reponses: dict[int, int]) -> dict[str, int]:
    """Les clés d'un objet JSON sont toujours des chaînes — c'est ce que le client
    envoie réellement, et ce que `SubmitRequestSerializer` doit savoir reconvertir."""
    return {str(question_id): choix_id for question_id, choix_id in reponses.items()}


# --- Durée plancher ----------------------------------------------------------


def test_soumission_a_la_seconde_exacte_du_plancher_est_acceptee(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    """`min_duration_s` est un plancher inclusif : à la seconde pile, on passe."""
    tentative = tentative_ancienne(
        user=etudiante, quiz=quiz_chapitre, secondes=quiz_chapitre.min_duration_s
    )
    reponse = _soumettre(
        client_etudiante, tentative.id, _en_chaines(bonnes_reponses(quiz_chapitre))
    )
    assert reponse.status_code == 200


def test_soumission_une_seconde_avant_le_plancher_est_refusee(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(
        user=etudiante, quiz=quiz_chapitre, secondes=quiz_chapitre.min_duration_s - 1
    )
    reponse = _soumettre(
        client_etudiante, tentative.id, _en_chaines(bonnes_reponses(quiz_chapitre))
    )
    assert reponse.status_code == 400


def test_une_soumission_trop_rapide_ne_consomme_aucune_tentative_et_ne_note_rien(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    """Atomicité (§7) : le refus intervient avant toute écriture. Sans ça, un étudiant
    perdrait une tentative en cliquant trop vite."""
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre, secondes=0)

    assert (
        _soumettre(
            client_etudiante, tentative.id, _en_chaines(bonnes_reponses(quiz_chapitre))
        ).status_code
        == 400
    )

    tentative.refresh_from_db()
    assert tentative.submitted_at is None
    assert tentative.score is None
    assert tentative.answers == {}

    etat = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}").json()
    assert etat["attempts_used"] == 0
    assert etat["attempts_remaining"] == quiz_chapitre.max_attempts


# --- Quota de tentatives -----------------------------------------------------


def test_une_tentative_ouverte_ne_consomme_pas_le_quota(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    """Rouvrir la page cinq fois ne doit pas brûler cinq tentatives (§4.4)."""
    for _ in range(5):
        assert client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts").status_code == 201

    assert Attempt.objects.filter(quiz=quiz_chapitre).count() == 1
    etat = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}").json()
    assert etat["attempts_used"] == 0
    assert etat["attempts_remaining"] == quiz_chapitre.max_attempts


def test_letat_du_quiz_dit_la_verite_sur_le_quota_et_le_meilleur_score(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    premiere = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    _soumettre(client_etudiante, premiere.id, _en_chaines(mauvaises_reponses(quiz_chapitre)))
    seconde = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    _soumettre(client_etudiante, seconde.id, _en_chaines(bonnes_reponses(quiz_chapitre)))

    etat = client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}").json()
    assert etat["attempts_used"] == 2
    assert etat["attempts_remaining"] == 0
    assert etat["best_score"] == 100

    # Et le serveur refuse bien d'en ouvrir une troisième (`max_attempts = 2`).
    assert client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts").status_code == 409


def test_un_quiz_a_zero_tentative_refuse_des_la_premiere_demande(
    client_etudiante: APIClient, inscription_active: Enrollment, quiz_chapitre: Quiz
) -> None:
    quiz_chapitre.max_attempts = 0
    quiz_chapitre.save(update_fields=["max_attempts"])

    reponse = client_etudiante.post(f"/api/quizzes/{quiz_chapitre.id}/attempts")

    assert reponse.status_code == 409
    assert Attempt.objects.count() == 0


# --- Double soumission -------------------------------------------------------


def test_la_seconde_soumission_est_refusee_et_nefface_pas_la_premiere(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    """Rejouer la soumission avec de meilleures réponses ne doit pas remonter le score
    d'une tentative déjà corrigée."""
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    premiere = _soumettre(
        client_etudiante, tentative.id, _en_chaines(mauvaises_reponses(quiz_chapitre))
    )
    assert premiere.status_code == 200
    assert premiere.json()["score"] == 0

    seconde = _soumettre(
        client_etudiante, tentative.id, _en_chaines(bonnes_reponses(quiz_chapitre))
    )

    assert seconde.status_code == 409
    tentative.refresh_from_db()
    assert tentative.score == 0
    assert tentative.passed is False


def test_un_examen_rejoue_ne_regonfle_pas_module_completion(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_examen: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_examen)
    _soumettre(client_etudiante, tentative.id, _en_chaines(mauvaises_reponses(quiz_examen)))
    completion = ModuleCompletion.objects.get(user=etudiante, module=quiz_examen.module)
    assert completion.exam_passed is False

    rejeu = _soumettre(client_etudiante, tentative.id, _en_chaines(bonnes_reponses(quiz_examen)))

    assert rejeu.status_code == 409
    completion.refresh_from_db()
    assert completion.exam_passed is False
    assert completion.best_score == 0


# --- Le score ne vient jamais du client --------------------------------------


def test_aucun_champ_du_corps_ninfluence_le_score_ni_le_verdict(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {
            "answers": _en_chaines(mauvaises_reponses(quiz_chapitre)),
            "score": 100,
            "passed": True,
            "attempts_remaining": 99,
            "pass_threshold": 0,
            "submitted_at": None,
        },
        format="json",
    )

    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["score"] == 0
    assert corps["passed"] is False
    assert corps["pass_threshold"] == quiz_chapitre.pass_threshold
    assert corps["attempts_remaining"] == quiz_chapitre.max_attempts - 1

    tentative.refresh_from_db()
    assert tentative.score == 0
    assert tentative.passed is False


def test_aucun_champ_descalade_de_privilege_nest_accepte(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
    etudiant_b: User,
) -> None:
    """§8 point 3 : `is_staff`, `role`, `user`, `enrollment_status` dans le corps."""
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit",
        {
            "answers": _en_chaines(bonnes_reponses(quiz_chapitre)),
            "is_staff": True,
            "role": "admin",
            "user": etudiant_b.pk,
            "enrollment_status": "ACTIVE",
        },
        format="json",
    )

    assert reponse.status_code == 200
    etudiante.refresh_from_db()
    assert etudiante.is_staff is False
    tentative.refresh_from_db()
    assert tentative.user_id == etudiante.pk
    assert "is_staff" not in str(reponse.json())


def test_le_demarrage_ignore_un_corps_forge(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
    etudiant_b: User,
) -> None:
    reponse = client_etudiante.post(
        f"/api/quizzes/{quiz_chapitre.id}/attempts",
        {
            "user": etudiant_b.pk,
            "started_at": "2000-01-01T00:00:00Z",
            "score": 100,
            "submitted_at": "2000-01-01T00:00:00Z",
        },
        format="json",
    )

    assert reponse.status_code == 201
    tentative = Attempt.objects.get(pk=reponse.json()["id"])
    assert tentative.user_id == etudiante.pk
    assert tentative.submitted_at is None
    assert tentative.score is None
    assert tentative.started_at > timezone.now() - dt.timedelta(minutes=1)
    assert set(reponse.json()) == {"id", "started_at"}


# --- Réponses malformées -----------------------------------------------------


def test_une_reponse_qui_designe_la_question_dun_autre_quiz_est_refusee(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    quiz_examen: Quiz,
    etudiante: User,
) -> None:
    """Symétrique du test sur les choix étrangers : une *question* qui n'appartient pas
    au quiz de la tentative est rejetée, et rien n'est écrit (atomicité)."""
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    question_etrangere = quiz_examen.questions.first()
    assert question_etrangere is not None
    choix = quiz_chapitre.questions.first()
    assert choix is not None
    choix_valide = choix.choices.first()
    assert choix_valide is not None

    reponse = _soumettre(
        client_etudiante, tentative.id, {str(question_etrangere.id): choix_valide.id}
    )

    assert reponse.status_code == 400
    tentative.refresh_from_db()
    assert tentative.submitted_at is None
    assert tentative.score is None
    assert not ModuleCompletion.objects.exists()


@pytest.mark.parametrize("cle", ["0", "-1", "-999"])
def test_un_identifiant_de_question_nul_ou_negatif_est_refuse(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
    cle: str,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    reponse = _soumettre(client_etudiante, tentative.id, {cle: 1})
    assert reponse.status_code == 400


@pytest.mark.parametrize(
    "corps",
    [
        {},
        {"answers": None},
        {"answers": []},
        {"answers": "10=100"},
        {"answers": {"10": "cent"}},
        {"answers": {"10": 0}},
        {"answers": {"10": -5}},
        {"answers": {"10": 1.5}},
    ],
)
def test_un_corps_de_soumission_malforme_est_refuse_avant_toute_correction(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
    corps: dict[str, object],
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = client_etudiante.post(f"/api/attempts/{tentative.id}/submit", corps, format="json")

    assert reponse.status_code == 400
    tentative.refresh_from_db()
    assert tentative.submitted_at is None


# --- Cas limites de barème ---------------------------------------------------


def test_un_quiz_sans_question_ne_divise_pas_par_zero(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    chapitre_gratuit: Any,
    etudiante: User,
) -> None:
    quiz = Quiz.objects.create(chapter=chapitre_gratuit, pass_threshold=60, min_duration_s=0)
    tentative = tentative_ancienne(user=etudiante, quiz=quiz)

    reponse = _soumettre(client_etudiante, tentative.id, {})

    assert reponse.status_code == 200
    assert reponse.json()["score"] == 0
    assert reponse.json()["passed"] is False
    assert reponse.json()["questions"] == []


def test_un_seuil_a_zero_fait_reussir_meme_un_score_nul(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    quiz_chapitre.pass_threshold = 0
    quiz_chapitre.save(update_fields=["pass_threshold"])
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = _soumettre(client_etudiante, tentative.id, {})

    assert reponse.status_code == 200
    assert reponse.json()["score"] == 0
    assert reponse.json()["passed"] is True


def test_des_reponses_partielles_donnent_un_score_partiel(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    toutes = bonnes_reponses(quiz_chapitre)
    premiere_question = next(iter(toutes))

    reponse = _soumettre(
        client_etudiante, tentative.id, {str(premiere_question): toutes[premiere_question]}
    )

    assert reponse.status_code == 200
    assert reponse.json()["score"] == 50
    tentative.refresh_from_db()
    # Seule la réponse réellement donnée est mémorisée : pas de choix inventé pour la
    # question laissée vide.
    assert tentative.answers == {str(premiere_question): toutes[premiere_question]}


def test_answers_vide_donne_zero_sans_rien_memoriser(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = _soumettre(client_etudiante, tentative.id, {})

    assert reponse.status_code == 200
    assert reponse.json()["score"] == 0
    tentative.refresh_from_db()
    assert tentative.answers == {}
    for question in reponse.json()["questions"]:
        assert all(choix["chosen"] is False for choix in question["choices"])


def test_une_question_sans_bonne_reponse_est_comptee_fausse_sans_planter(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    """Défaut de saisie côté admin : aucun choix n'est marqué correct. Le barème ne doit
    ni exploser ni offrir le point."""
    questions = list(quiz_chapitre.questions.all())
    Choice.objects.filter(question=questions[0]).update(is_correct=False)
    # Le premier choix de chaque question : sur la question sabotée, aucun n'est bon.
    reponses = {}
    for question in questions:
        premier = question.choices.first()
        assert premier is not None
        reponses[str(question.id)] = premier.id
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = _soumettre(client_etudiante, tentative.id, reponses)

    assert reponse.status_code == 200
    assert reponse.json()["score"] == 50


def test_repondre_avec_le_choix_dune_autre_question_du_meme_quiz_ne_donne_pas_le_point(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    """Le service l'accepte (ce n'est pas une attaque) mais ne doit jamais le compter
    juste — sinon un client bricolé marquerait 100 % en recopiant un seul id."""
    questions = list(quiz_chapitre.questions.all())
    bonne_de_la_seconde = next(c for c in questions[1].choices.all() if c.is_correct)
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = _soumettre(
        client_etudiante,
        tentative.id,
        {str(questions[0].id): bonne_de_la_seconde.id},
    )

    assert reponse.status_code == 200
    assert reponse.json()["score"] == 0


def test_le_score_arrondi_reste_dans_les_bornes_dun_pourcentage(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    quiz_chapitre: Quiz,
    etudiante: User,
) -> None:
    """Trois questions, une bonne réponse : 33 % (`PositiveSmallIntegerField` en base)."""
    troisieme = Question.objects.create(
        quiz=quiz_chapitre, order=3, text="Question 3 ?", explanation="Explication 3."
    )
    Choice.objects.create(question=troisieme, order=1, text="Bonne réponse", is_correct=True)
    Choice.objects.create(question=troisieme, order=2, text="Mauvaise", is_correct=False)

    toutes = bonnes_reponses(quiz_chapitre)
    premiere = next(iter(toutes))
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)

    reponse = _soumettre(client_etudiante, tentative.id, {str(premiere): toutes[premiere]})

    assert reponse.status_code == 200
    assert reponse.json()["score"] == 33
    tentative.refresh_from_db()
    assert tentative.score == 33

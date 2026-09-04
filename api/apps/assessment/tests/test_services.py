"""Logique métier des QCM (CLAUDE.md §7) : mémorisation du meilleur score, non-régression
de `exam_passed`, calcul du score."""

from __future__ import annotations

import pytest

from apps.accounts.models import User
from apps.assessment import services
from apps.assessment.models import Attempt, Quiz
from apps.assessment.tests.conftest import bonnes_reponses, mauvaises_reponses, tentative_ancienne
from apps.learning.models import ModuleCompletion


def test_etat_quiz_ne_porte_aucun_is_correct(etudiante: User, quiz_chapitre: Quiz) -> None:
    etat = services.etat_quiz(user=etudiante, quiz=quiz_chapitre)
    for question in etat.questions:
        for choix in question.choices:
            assert not hasattr(choix, "is_correct")


def test_demarrer_tentative_leve_apres_le_quota(etudiante: User, quiz_chapitre: Quiz) -> None:
    for _ in range(quiz_chapitre.max_attempts):
        tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
        services.soumettre_tentative(
            user=etudiante, attempt_id=tentative.id, reponses=mauvaises_reponses(quiz_chapitre)
        )
    with pytest.raises(services.TentativesEpuiseesError):
        services.demarrer_tentative(user=etudiante, quiz=quiz_chapitre)


def test_soumettre_met_a_jour_le_meilleur_score_sans_jamais_le_faire_baisser(
    etudiante: User, quiz_examen: Quiz
) -> None:
    premiere = tentative_ancienne(user=etudiante, quiz=quiz_examen)
    services.soumettre_tentative(
        user=etudiante, attempt_id=premiere.id, reponses=bonnes_reponses(quiz_examen)
    )
    completion = ModuleCompletion.objects.get(user=etudiante, module=quiz_examen.module)
    assert completion.best_score == 100
    assert completion.exam_passed is True
    premier_instant = completion.passed_at

    # Une seconde tentative moins bonne ne dégrade ni le meilleur score, ni la réussite,
    # ni l'horodatage de la première réussite.
    quiz_examen.max_attempts = 5
    quiz_examen.save(update_fields=["max_attempts"])
    seconde = tentative_ancienne(user=etudiante, quiz=quiz_examen)
    services.soumettre_tentative(
        user=etudiante, attempt_id=seconde.id, reponses=mauvaises_reponses(quiz_examen)
    )
    completion.refresh_from_db()
    assert completion.best_score == 100
    assert completion.exam_passed is True
    assert completion.passed_at == premier_instant


def test_soumettre_naffecte_pas_module_completion_pour_un_quiz_de_chapitre(
    etudiante: User, quiz_chapitre: Quiz
) -> None:
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_chapitre)
    services.soumettre_tentative(
        user=etudiante, attempt_id=tentative.id, reponses=bonnes_reponses(quiz_chapitre)
    )
    assert not ModuleCompletion.objects.exists()


def test_soumettre_refuse_trop_tot(etudiante: User, quiz_chapitre: Quiz) -> None:
    tentative = Attempt.objects.create(user=etudiante, quiz=quiz_chapitre)
    with pytest.raises(services.SoumissionTropRapideError):
        services.soumettre_tentative(
            user=etudiante, attempt_id=tentative.id, reponses=bonnes_reponses(quiz_chapitre)
        )

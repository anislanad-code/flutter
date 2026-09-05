"""Logique métier des QCM (CLAUDE.md §7) : mémorisation du meilleur score, non-régression
de `exam_passed`, calcul du score."""

from __future__ import annotations

import threading

import pytest
from django.db import connections

from apps.accounts.models import User
from apps.assessment import services
from apps.assessment.models import Attempt, Quiz
from apps.assessment.tests.conftest import bonnes_reponses, mauvaises_reponses, tentative_ancienne
from apps.enrollment.models import Enrollment
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
    etudiante: User, quiz_examen: Quiz, inscription_active: Enrollment
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


def test_soumettre_refuse_une_tentative_dont_lacces_a_ete_retire_depuis(
    etudiante: User, quiz_examen: Quiz, inscription_active: Enrollment
) -> None:
    """Revérifié à la soumission, pas seulement au démarrage (§4.3) : une inscription
    passée en `BLOCKED` entre les deux ne doit pas laisser une tentative déjà ouverte
    soumissible — sans quoi démarrer une tentative pendant qu'on a encore accès
    suffirait à contourner un blocage décidé ensuite par l'admin."""
    tentative = tentative_ancienne(user=etudiante, quiz=quiz_examen)
    inscription_active.status = Enrollment.Status.BLOCKED
    inscription_active.save(update_fields=["status"])

    with pytest.raises(services.TentativeIntrouvableError):
        services.soumettre_tentative(
            user=etudiante, attempt_id=tentative.id, reponses=bonnes_reponses(quiz_examen)
        )


@pytest.mark.django_db(transaction=True)
def test_demarrer_tentative_reste_correcte_sous_deux_requetes_concurrentes(
    etudiante: User, quiz_chapitre: Quiz
) -> None:
    """Le `SELECT ... FOR UPDATE` initial ne verrouille rien quand il ne trouve aucune
    ligne ouverte : deux requêtes concurrentes (double clic, deux onglets) peuvent
    toutes les deux passer ce point et tenter de créer une tentative. La contrainte
    `attempt_une_seule_ouverte_par_utilisateur_quiz` doit alors faire échouer l'une des
    deux créations, et `demarrer_tentative` doit rattraper cet échec en renvoyant la
    tentative de l'autre — jamais laisser deux tentatives ouvertes, jamais laisser
    l'`IntegrityError` remonter."""
    resultats: list[int] = []
    exceptions: list[BaseException] = []
    barriere = threading.Barrier(2)

    def demarrer() -> None:
        barriere.wait(timeout=5)
        try:
            resultats.append(services.demarrer_tentative(user=etudiante, quiz=quiz_chapitre).id)
        except BaseException as exc:  # on veut voir toute exception levée dans le thread
            exceptions.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=demarrer) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert exceptions == []
    assert len(resultats) == 2
    assert resultats[0] == resultats[1]
    assert Attempt.objects.filter(quiz=quiz_chapitre, submitted_at__isnull=True).count() == 1

"""Déverrouillage d'un module par l'examen du précédent (étape 6).

`calculer_pipeline` a changé de règle à cette étape : un module n'est plus déverrouillé
par la seule complétion des chapitres du précédent, il faut aussi que l'examen du
précédent — **s'il en a un** — soit réussi. Ce fichier fixe la nouvelle règle et vérifie
qu'elle n'a rien cassé du soft gating (§2 : jamais de 403, tout reste cliquable).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.assessment.models import Attempt, Choice, Question, Quiz
from apps.catalog.models import Chapter, Module
from apps.enrollment.models import Enrollment
from apps.learning.models import ModuleCompletion, Progress
from apps.learning.services import calculer_pipeline


def _examen(module: Module, *, seuil: int = 60) -> Quiz:
    quiz = Quiz.objects.create(module=module, pass_threshold=seuil, min_duration_s=0)
    question = Question.objects.create(quiz=quiz, order=1, text="Question d'examen ?")
    Choice.objects.create(question=question, order=1, text="Bonne", is_correct=True)
    Choice.objects.create(question=question, order=2, text="Mauvaise", is_correct=False)
    return quiz


def _bonnes(quiz: Quiz) -> dict[str, int]:
    return {
        str(q.id): next(c.id for c in q.choices.all() if c.is_correct) for q in quiz.questions.all()
    }


def _mauvaises(quiz: Quiz) -> dict[str, int]:
    return {
        str(q.id): next(c.id for c in q.choices.all() if not c.is_correct)
        for q in quiz.questions.all()
    }


def _terminer(user: User, chapitre: Chapter) -> None:
    Progress.objects.update_or_create(
        user=user,
        chapter=chapitre,
        defaults={"state": Progress.State.DONE, "completed_at": timezone.now()},
    )


def _module(pipeline: Any, ordre: int) -> Any:
    return next(m for m in pipeline["modules"] if m["order"] == ordre)


def test_tous_les_chapitres_termines_ne_suffisent_plus_si_le_module_a_un_examen(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    etudiante: User,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    _examen(module_0)
    _terminer(etudiante, chapitre_0a)
    _terminer(etudiante, chapitre_0b)

    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    assert _module(pipeline, 0)["exam_passed"] is False
    assert _module(pipeline, 1)["unlocked"] is False
    assert _module(pipeline, 1)["recommande_apres_ordre"] == 0


def test_un_examen_echoue_ne_deverrouille_pas_le_module_suivant(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    etudiante: User,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    quiz = _examen(module_0)
    _terminer(etudiante, chapitre_0a)
    _terminer(etudiante, chapitre_0b)
    tentative = Attempt.objects.create(
        user=etudiante, quiz=quiz, started_at=timezone.now() - dt.timedelta(hours=1)
    )

    reponse = client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit", {"answers": _mauvaises(quiz)}, format="json"
    )

    assert reponse.status_code == 200
    assert reponse.json()["passed"] is False
    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    assert _module(pipeline, 0)["exam_passed"] is False
    assert _module(pipeline, 1)["unlocked"] is False


def test_un_examen_reussi_deverrouille_le_suivant_et_letat_survit_a_un_rechargement(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    etudiante: User,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    quiz = _examen(module_0)
    _terminer(etudiante, chapitre_0a)
    _terminer(etudiante, chapitre_0b)
    tentative = Attempt.objects.create(
        user=etudiante, quiz=quiz, started_at=timezone.now() - dt.timedelta(hours=1)
    )

    client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit", {"answers": _bonnes(quiz)}, format="json"
    )

    premier = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    second = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    assert premier == second
    assert _module(premier, 0)["exam_passed"] is True
    assert _module(premier, 1)["unlocked"] is True


def test_un_examen_reussi_avant_la_fin_des_chapitres_ne_deverrouille_pas_le_suivant(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    etudiante: User,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    """Les deux conditions sont cumulatives : chapitres terminés **et** examen réussi."""
    quiz = _examen(module_0)
    _terminer(etudiante, chapitre_0a)  # `chapitre_0b` reste ouvert
    tentative = Attempt.objects.create(
        user=etudiante, quiz=quiz, started_at=timezone.now() - dt.timedelta(hours=1)
    )
    client_etudiante.post(
        f"/api/attempts/{tentative.id}/submit", {"answers": _bonnes(quiz)}, format="json"
    )

    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    assert _module(pipeline, 0)["exam_passed"] is True
    assert _module(pipeline, 1)["unlocked"] is False


def test_un_module_sans_examen_deverrouille_le_suivant_comme_avant(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    etudiante: User,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
    cours: Any,
) -> None:
    """Non-régression de l'étape 5 : sans examen, la règle d'origine reste la seule."""
    _terminer(etudiante, chapitre_0a)
    _terminer(etudiante, chapitre_0b)

    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    assert _module(pipeline, 0)["exam_quiz_id"] is None
    assert _module(pipeline, 1)["unlocked"] is True


def test_le_pipeline_expose_lid_du_qcm_de_chaque_chapitre_et_de_lexamen(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    chapitre_0a: Chapter,
    chapitre_1a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    quiz_chapitre = Quiz.objects.create(chapter=chapitre_0a, min_duration_s=0)
    examen = _examen(module_0)

    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    module_zero = _module(pipeline, 0)
    assert module_zero["exam_quiz_id"] == examen.id
    assert module_zero["chapters"][0]["quiz_id"] == quiz_chapitre.id
    # Le module suivant n'a ni QCM ni examen : `None`, jamais l'id d'un autre module.
    assert _module(pipeline, 1)["exam_quiz_id"] is None
    assert _module(pipeline, 1)["chapters"][0]["quiz_id"] is None


def test_le_pipeline_ne_fuit_ni_les_choix_ni_les_bonnes_reponses(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    chapitre_0a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    """Le pipeline ne porte que des identifiants de QCM (§4.4) — pas leur contenu."""
    _examen(module_0)
    Quiz.objects.create(chapter=chapitre_0a, min_duration_s=0)

    corps = client_etudiante.get("/api/progress", {"course": cours.slug}).content.decode()

    for interdit in ("is_correct", "Bonne", "Mauvaise", "Question d'examen", "explanation"):
        assert interdit not in corps


def test_un_compte_pending_ne_recoit_quun_pointeur_dexamen_jamais_son_contenu(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    chapitre_0a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    """Le pipeline d'un compte `PENDING` porte bien `exam_quiz_id` — un identifiant, pas
    du contenu — et la porte au bout reste fermée (404). L'écran `/app` d'un compte non
    actif n'affiche de toute façon pas `Pipeline` (il s'arrête à `ParcoursEtudiant`),
    donc aucun lien mort n'est proposé ; ce test fixe le fait que l'id seul ne suffit
    jamais à ouvrir l'examen (§4.4)."""
    examen = _examen(module_0)

    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    corps = str(pipeline)

    assert _module(pipeline, 0)["exam_quiz_id"] == examen.id
    assert client_etudiante.get(f"/api/quizzes/{examen.id}").status_code == 404
    assert client_etudiante.post(f"/api/quizzes/{examen.id}/attempts").status_code == 404
    for interdit in ("Question d'examen", "Bonne", "is_correct"):
        assert interdit not in corps


def test_le_qcm_dun_module_non_deverrouille_reste_accessible_sur_un_compte_actif(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    etudiante: User,
    chapitre_0a: Chapter,
    chapitre_1a: Chapter,
    module_1: Module,
    cours: Any,
) -> None:
    """Soft gating (§2) : `recommande_plus_tard` ne doit jamais devenir un refus. Un
    étudiant actif peut passer l'examen du module 1 avant celui du module 0."""
    examen_tardif = _examen(module_1)

    lecture = client_etudiante.get(f"/api/quizzes/{examen_tardif.id}")
    demarrage = client_etudiante.post(f"/api/quizzes/{examen_tardif.id}/attempts")
    tentative_id = demarrage.json()["id"]
    Attempt.objects.filter(pk=tentative_id).update(
        started_at=timezone.now() - dt.timedelta(hours=1)
    )
    soumission = client_etudiante.post(
        f"/api/attempts/{tentative_id}/submit",
        {"answers": _bonnes(examen_tardif)},
        format="json",
    )

    assert [lecture.status_code, demarrage.status_code, soumission.status_code] == [
        200,
        201,
        200,
    ]
    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    assert _module(pipeline, 1)["exam_passed"] is True
    assert _module(pipeline, 1)["unlocked"] is False


def test_le_service_calcule_le_meme_etat_que_lapi(
    etudiante: User,
    inscription_active: Enrollment,
    chapitre_0a: Chapter,
    chapitre_1a: Chapter,
    module_0: Module,
    cours: Any,
) -> None:
    """`calculer_pipeline` est la seule source de vérité (§7) : appelé directement, il
    donne le même verrouillage que la vue."""
    _examen(module_0)
    _terminer(etudiante, chapitre_0a)

    pipeline = calculer_pipeline(user=etudiante, course=cours)

    assert pipeline.modules[1].unlocked is False
    assert pipeline.modules[0].exam_passed is False

    ModuleCompletion.objects.create(user=etudiante, module=module_0, exam_passed=True)
    apres = calculer_pipeline(user=etudiante, course=cours)
    assert apres.modules[1].unlocked is True

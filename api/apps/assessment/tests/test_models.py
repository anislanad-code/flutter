"""`__str__` : lisibilité dans l'admin Django, rien de fonctionnel — mais un test vaut
mieux qu'un code mort non exécuté (§7)."""

from __future__ import annotations

from django.contrib import admin as django_admin

from apps.accounts.models import User
from apps.assessment.admin import AttemptAdmin
from apps.assessment.models import Attempt, Quiz


def test_str_dun_quiz_de_chapitre(quiz_chapitre: Quiz) -> None:
    assert "QCM" in str(quiz_chapitre)


def test_str_dune_question_et_dun_choix(quiz_chapitre: Quiz) -> None:
    question = quiz_chapitre.questions.first()
    assert question is not None
    assert str(quiz_chapitre) in str(question)
    choix = question.choices.first()
    assert choix is not None
    assert str(choix) == choix.text


def test_str_dune_tentative_avant_et_apres_correction(etudiante: User, quiz_chapitre: Quiz) -> None:
    tentative = Attempt.objects.create(user=etudiante, quiz=quiz_chapitre)
    assert "en cours" in str(tentative)
    tentative.score = 80
    assert "80" in str(tentative)


def test_admin_des_tentatives_est_strictement_lecture_seule() -> None:
    interface = AttemptAdmin(Attempt, django_admin.site)
    assert interface.has_add_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_change_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_delete_permission(None) is False  # type: ignore[arg-type]

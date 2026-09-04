"""Contraintes de base et migration de l'étape 6.

Les invariantes du §5 ne sont pas des commentaires : `quiz_xor_chapitre_module` et
`question_ordre_unique_par_quiz` sont posées en base, donc elles doivent tenir même si
un jour du code contourne les services. On les vérifie ici en écrivant directement.
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.assessment.models import Choice, Question, Quiz
from apps.catalog.models import Chapter, Module


def test_un_quiz_ne_peut_pas_viser_a_la_fois_un_chapitre_et_un_module(
    chapitre_gratuit: Chapter, module_0: Module
) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Quiz.objects.create(chapter=chapitre_gratuit, module=module_0)


def test_un_quiz_orphelin_est_refuse_par_la_base(db: None) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Quiz.objects.create(chapter=None, module=None)


def test_deux_questions_ne_partagent_pas_le_meme_ordre_dans_un_quiz(
    quiz_chapitre: Quiz,
) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Question.objects.create(quiz=quiz_chapitre, order=1, text="Doublon d'ordre ?")


def test_le_meme_ordre_est_autorise_dans_deux_quiz_differents(
    quiz_chapitre: Quiz, quiz_examen: Quiz
) -> None:
    question = Question.objects.create(quiz=quiz_examen, order=99, text="Q ?")
    autre = Question.objects.create(quiz=quiz_chapitre, order=99, text="Q ?")
    assert question.pk != autre.pk


def test_un_chapitre_na_quun_seul_qcm_et_un_module_quun_seul_examen(
    chapitre_gratuit: Chapter, module_0: Module, quiz_chapitre: Quiz, quiz_examen: Quiz
) -> None:
    """`OneToOneField` (§5) : pas de liste de QCM à départager côté vue."""
    with pytest.raises(IntegrityError), transaction.atomic():
        Quiz.objects.create(chapter=chapitre_gratuit)
    with pytest.raises(IntegrityError), transaction.atomic():
        Quiz.objects.create(module=module_0)


def test_les_questions_et_les_choix_sortent_dans_lordre_declare(
    quiz_chapitre: Quiz,
) -> None:
    """`Meta.ordering` : l'API ne trie pas, elle s'appuie dessus. Un ordre instable
    ferait sauter la numérotation « Question 2/3 » côté client à chaque rechargement."""
    question = Question.objects.create(quiz=quiz_chapitre, order=0, text="Question zéro ?")
    Choice.objects.create(question=question, order=5, text="Cinquième")
    Choice.objects.create(question=question, order=1, text="Première")

    assert [q.order for q in quiz_chapitre.questions.all()] == [0, 1, 2]
    assert [c.text for c in question.choices.all()] == ["Première", "Cinquième"]


def test_supprimer_un_chapitre_emporte_son_qcm_et_ses_tentatives(
    quiz_chapitre: Quiz, chapitre_gratuit: Chapter
) -> None:
    """`on_delete=CASCADE` : dépublier un chapitre ne doit pas laisser de QCM orphelin
    pointant sur un contenu disparu (le `Quiz` deviendrait alors invalide au regard de
    `quiz_xor_chapitre_module`)."""
    identifiant = quiz_chapitre.pk
    chapitre_gratuit.delete()

    assert not Quiz.objects.filter(pk=identifiant).exists()
    assert not Question.objects.filter(quiz_id=identifiant).exists()

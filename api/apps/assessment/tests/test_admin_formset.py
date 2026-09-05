"""`ChoiceInlineFormSet` : exactement une bonne réponse par question, imposé à la
saisie admin (CLAUDE.md §1 — l'admin est le seul outil d'édition de contenu)."""

from __future__ import annotations

from django.forms.models import inlineformset_factory

from apps.assessment.admin import ChoiceInlineFormSet
from apps.assessment.models import Choice, Question, Quiz

ChoiceFormSet = inlineformset_factory(
    Question, Choice, formset=ChoiceInlineFormSet, fields=["order", "text", "is_correct"], extra=2
)


def _donnees(*choix: tuple[str, bool]) -> dict[str, str]:
    donnees = {
        "choices-TOTAL_FORMS": str(len(choix)),
        "choices-INITIAL_FORMS": "0",
        "choices-MIN_NUM_FORMS": "0",
        "choices-MAX_NUM_FORMS": "1000",
    }
    for i, (texte, correcte) in enumerate(choix):
        donnees[f"choices-{i}-order"] = str(i)
        donnees[f"choices-{i}-text"] = texte
        if correcte:
            donnees[f"choices-{i}-is_correct"] = "on"
    return donnees


def test_refuse_une_question_sans_aucune_bonne_reponse(db: None, quiz_chapitre: Quiz) -> None:
    question = Question.objects.create(quiz=quiz_chapitre, order=99, text="?")
    formset = ChoiceFormSet(
        data=_donnees(("A", False), ("B", False)), instance=question, prefix="choices"
    )
    assert formset.is_valid() is False
    assert "exactement une bonne réponse" in str(formset.non_form_errors())


def test_refuse_une_question_avec_deux_bonnes_reponses(db: None, quiz_chapitre: Quiz) -> None:
    question = Question.objects.create(quiz=quiz_chapitre, order=99, text="?")
    formset = ChoiceFormSet(
        data=_donnees(("A", True), ("B", True)), instance=question, prefix="choices"
    )
    assert formset.is_valid() is False
    assert "exactement une bonne réponse" in str(formset.non_form_errors())


def test_accepte_une_question_avec_exactement_une_bonne_reponse(
    db: None, quiz_chapitre: Quiz
) -> None:
    question = Question.objects.create(quiz=quiz_chapitre, order=99, text="?")
    formset = ChoiceFormSet(
        data=_donnees(("A", True), ("B", False)), instance=question, prefix="choices"
    )
    assert formset.is_valid() is True


def test_ignore_les_lignes_marquees_pour_suppression(db: None, quiz_chapitre: Quiz) -> None:
    question = Question.objects.create(quiz=quiz_chapitre, order=99, text="?")
    bonne = Choice.objects.create(question=question, order=0, text="A", is_correct=True)
    # `is_correct=False` en base : le formulaire soumis la coche quand même (ci-dessous)
    # pour vérifier que c'est bien `DELETE` qui l'exclut du décompte, pas sa valeur
    # actuelle — sans quoi enregistrer les deux à `True` violerait la contrainte de
    # base avant même d'atteindre le formset.
    a_supprimer = Choice.objects.create(question=question, order=1, text="B", is_correct=False)

    donnees = {
        "choices-TOTAL_FORMS": "2",
        "choices-INITIAL_FORMS": "2",
        "choices-MIN_NUM_FORMS": "0",
        "choices-MAX_NUM_FORMS": "1000",
        "choices-0-id": str(bonne.id),
        "choices-0-order": "0",
        "choices-0-text": "A",
        "choices-0-is_correct": "on",
        "choices-1-id": str(a_supprimer.id),
        "choices-1-order": "1",
        "choices-1-text": "B",
        "choices-1-is_correct": "on",
        "choices-1-DELETE": "on",
    }
    formset = ChoiceFormSet(data=donnees, instance=question, prefix="choices")

    # Une bonne réponse active, une seconde marquée supprimée : le solde après
    # suppression reste « exactement une », donc valide.
    assert formset.is_valid() is True

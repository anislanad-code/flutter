"""Logique métier des QCM et examens (CLAUDE.md §7 : jamais dans les vues).

Anti-triche minimal (§4.4) : une soumission plus rapide que `min_duration_s` est
rejetée, le nombre de tentatives est plafonné côté serveur, et aucune fonction d'ici
n'accepte un score ou une correction venus du client — seul `Choice.is_correct` en
base tranche.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.accounts.models import User
from apps.assessment.models import Attempt, Choice, Question, Quiz
from apps.enrollment.services import a_acces_au_contenu
from apps.learning.models import ModuleCompletion


class TentativesEpuiseesError(Exception):
    """Le nombre maximum de tentatives soumises est atteint (§8)."""


class TentativeIntrouvableError(Exception):
    """Aucune tentative avec cet id pour cet utilisateur. Traduit en 404 (§4.3) — ne
    distingue jamais « n'existe pas » de « appartient à quelqu'un d'autre »."""


class TentativeDejaSoumiseError(Exception):
    """La tentative a déjà une correction : pas de double soumission."""


class SoumissionTropRapideError(Exception):
    """Moins de `min_duration_s` se sont écoulées depuis `started_at` (§4.4)."""


class ReponsesInvalidesError(Exception):
    """Une réponse désigne une question ou un choix qui n'appartient pas au quiz."""


def a_acces_au_quiz(*, user: User, quiz: Quiz) -> bool:
    """Un QCM de chapitre suit exactement la règle du chapitre (§4.4) ; un examen de
    module n'est jamais gratuit — seul le premier chapitre l'est, pas le module entier.
    """
    chapter = quiz.chapter
    if chapter is not None:
        return chapter.is_free or a_acces_au_contenu(user, chapter.module.course)
    module = quiz.module
    assert module is not None  # garanti par la contrainte `quiz_xor_chapitre_module`
    return a_acces_au_contenu(user, module.course)


# --- Lecture (GET /api/quizzes/{id}) ----------------------------------------


@dataclass(frozen=True)
class ChoixPublic:
    id: int
    text: str


@dataclass(frozen=True)
class QuestionPublique:
    id: int
    order: int
    text: str
    choices: list[ChoixPublic]


@dataclass(frozen=True)
class EtatQuiz:
    id: int
    kind: str
    pass_threshold: int
    max_attempts: int
    min_duration_s: int
    attempts_used: int
    attempts_remaining: int
    best_score: int | None
    questions: list[QuestionPublique]


def _tentatives_soumises(*, user: User, quiz: Quiz) -> int:
    return Attempt.objects.filter(user=user, quiz=quiz, submitted_at__isnull=False).count()


def etat_quiz(*, user: User, quiz: Quiz) -> EtatQuiz:
    """Aucun champ `is_correct` ici (§4.4) : `ChoixPublic` ne porte que `id` et `text`."""
    soumises = _tentatives_soumises(user=user, quiz=quiz)
    meilleur = Attempt.objects.filter(
        user=user, quiz=quiz, submitted_at__isnull=False
    ).aggregate(m=Max("score"))["m"]

    questions = [
        QuestionPublique(
            id=question.id,
            order=question.order,
            text=question.text,
            choices=[ChoixPublic(id=c.id, text=c.text) for c in question.choices.all()],
        )
        for question in quiz.questions.all()
    ]

    return EtatQuiz(
        id=quiz.id,
        kind=quiz.kind,
        pass_threshold=quiz.pass_threshold,
        max_attempts=quiz.max_attempts,
        min_duration_s=quiz.min_duration_s,
        attempts_used=soumises,
        attempts_remaining=max(0, quiz.max_attempts - soumises),
        best_score=meilleur,
        questions=questions,
    )


# --- Démarrage d'une tentative -----------------------------------------------


@transaction.atomic
def demarrer_tentative(*, user: User, quiz: Quiz) -> Attempt:
    """Réutilise une tentative déjà ouverte (non soumise) plutôt que d'en empiler une
    nouvelle à chaque clic — sinon rouvrir la page recommencerait le chrono anti-triche
    sans raison et gonflerait `max_attempts` pour rien."""
    ouverte = (
        Attempt.objects.select_for_update()
        .filter(user=user, quiz=quiz, submitted_at__isnull=True)
        .order_by("-started_at")
        .first()
    )
    if ouverte is not None:
        return ouverte

    if _tentatives_soumises(user=user, quiz=quiz) >= quiz.max_attempts:
        raise TentativesEpuiseesError

    return Attempt.objects.create(user=user, quiz=quiz)


# --- Soumission et correction -------------------------------------------------


@dataclass(frozen=True)
class ChoixCorrige:
    id: int
    text: str
    is_correct: bool
    chosen: bool


@dataclass(frozen=True)
class QuestionCorrigee:
    id: int
    text: str
    explanation: str
    choices: list[ChoixCorrige]


@dataclass(frozen=True)
class ResultatTentative:
    attempt_id: int
    score: int
    passed: bool
    pass_threshold: int
    attempts_remaining: int
    questions: list[QuestionCorrigee]


def _mettre_a_jour_completion_module(
    *, user: User, module_id: int, score: int, reussi: bool
) -> None:
    completion, _ = ModuleCompletion.objects.select_for_update().get_or_create(
        user=user, module_id=module_id
    )
    champs: list[str] = []
    if completion.best_score is None or score > completion.best_score:
        completion.best_score = score
        champs.append("best_score")
    if reussi and not completion.exam_passed:
        completion.exam_passed = True
        completion.passed_at = timezone.now()
        champs.extend(["exam_passed", "passed_at"])
    if champs:
        completion.save(update_fields=champs)


@transaction.atomic
def soumettre_tentative(
    *, user: User, attempt_id: int, reponses: dict[int, int]
) -> ResultatTentative:
    tentative = (
        Attempt.objects.select_for_update()
        .select_related("quiz")
        .filter(pk=attempt_id, user=user)
        .first()
    )
    if tentative is None:
        raise TentativeIntrouvableError
    if tentative.submitted_at is not None:
        raise TentativeDejaSoumiseError

    maintenant = timezone.now()
    ecoule_s = (maintenant - tentative.started_at).total_seconds()
    if ecoule_s < tentative.quiz.min_duration_s:
        raise SoumissionTropRapideError

    questions = list(
        Question.objects.filter(quiz=tentative.quiz).prefetch_related("choices")
    )
    ids_questions_valides = {q.id for q in questions}
    if any(qid not in ids_questions_valides for qid in reponses):
        raise ReponsesInvalidesError

    # Un choix qui n'appartient à aucune question de *ce* quiz est rejeté — sans quoi
    # un id de choix d'un autre quiz, transmis à la main, atterrirait dans `answers`
    # sans jamais être détecté. Un choix qui appartient bien au quiz mais à la
    # *mauvaise* question, en revanche, n'a rien d'une attaque : il est simplement noté
    # incorrect pour la question à laquelle il ne correspond pas (vérifié plus bas).
    ids_choix_valides_du_quiz = {c.id for q in questions for c in q.choices.all()}
    if any(choix_id not in ids_choix_valides_du_quiz for choix_id in reponses.values()):
        raise ReponsesInvalidesError

    total = len(questions)
    correctes = 0
    reponses_stockees: dict[str, int] = {}
    questions_corrigees: list[QuestionCorrigee] = []

    for question in questions:
        choix_choisi_id = reponses.get(question.id)
        choix_liste: list[Choice] = list(question.choices.all())

        bonne_reponse = next((c for c in choix_liste if c.is_correct), None)
        est_correcte = bonne_reponse is not None and choix_choisi_id == bonne_reponse.id
        if est_correcte:
            correctes += 1
        if choix_choisi_id is not None:
            reponses_stockees[str(question.id)] = choix_choisi_id

        questions_corrigees.append(
            QuestionCorrigee(
                id=question.id,
                text=question.text,
                explanation=question.explanation,
                choices=[
                    ChoixCorrige(
                        id=c.id,
                        text=c.text,
                        is_correct=c.is_correct,
                        chosen=(c.id == choix_choisi_id),
                    )
                    for c in choix_liste
                ],
            )
        )

    score = round((correctes / total) * 100) if total > 0 else 0
    reussi = score >= tentative.quiz.pass_threshold

    tentative.submitted_at = maintenant
    tentative.score = score
    tentative.passed = reussi
    tentative.answers = reponses_stockees
    tentative.save(update_fields=["submitted_at", "score", "passed", "answers"])

    if tentative.quiz.module_id is not None:
        _mettre_a_jour_completion_module(
            user=user, module_id=tentative.quiz.module_id, score=score, reussi=reussi
        )

    soumises = _tentatives_soumises(user=user, quiz=tentative.quiz)
    return ResultatTentative(
        attempt_id=tentative.id,
        score=score,
        passed=reussi,
        pass_threshold=tentative.quiz.pass_threshold,
        attempts_remaining=max(0, tentative.quiz.max_attempts - soumises),
        questions=questions_corrigees,
    )

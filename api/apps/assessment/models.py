"""QCM de chapitre et examens de module (CLAUDE.md §5).

Un `Quiz` est attaché soit à un chapitre (QCM de fin de chapitre), soit à un module
(examen de fin de module) — jamais les deux, jamais aucun des deux : la contrainte
`quiz_xor_chapitre_module` le garantit en base, pas seulement côté application.

`Choice.is_correct` ne quitte jamais l'API avant soumission (§4.4) : les serializers
publics (`apps/assessment/serializers.py`) ne l'exposent que dans les serializers de
résultat, construits uniquement après qu'`Attempt.submitted_at` est posé.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class Quiz(models.Model):
    # `OneToOneField` : un chapitre n'a au plus qu'un seul QCM, un module au plus un
    # seul examen — pas de liste à départager côté vue.
    chapter = models.OneToOneField(
        "catalog.Chapter",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="quiz",
    )
    module = models.OneToOneField(
        "catalog.Module",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="exam",
    )
    pass_threshold = models.PositiveSmallIntegerField(default=60)
    max_attempts = models.PositiveSmallIntegerField(default=3)
    min_duration_s = models.PositiveIntegerField(default=20)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(chapter__isnull=False, module__isnull=True)
                    | models.Q(chapter__isnull=True, module__isnull=False)
                ),
                name="quiz_xor_chapitre_module",
            )
        ]

    def __str__(self) -> str:
        cible = self.chapter if self.chapter_id else self.module
        return f"QCM — {cible}"

    @property
    def kind(self) -> str:
        return "chapitre" if self.chapter_id else "examen"


class Question(models.Model):
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="questions")
    order = models.PositiveIntegerField()
    text = models.TextField()
    # Affichée uniquement après soumission (écran de résultat) — jamais par
    # `GET /api/quizzes/{id}` avant que l'étudiant n'ait répondu.
    explanation = models.TextField(blank=True)

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(fields=["quiz", "order"], name="question_ordre_unique_par_quiz")
        ]

    def __str__(self) -> str:
        return f"{self.quiz} — question {self.order}"


class Choice(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="choices")
    order = models.PositiveIntegerField(default=0)
    text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)

    class Meta:
        ordering = ["order"]
        constraints = [
            # Au plus une bonne réponse par question, défendu en base (comme
            # `quiz_xor_chapitre_module`) : une deuxième coche `is_correct` sur la même
            # question ne doit pas pouvoir être enregistrée en silence. Le minimum —
            # *au moins* une bonne réponse — est imposé à la saisie par l'admin
            # (`ChoiceInlineFormSet`, dans `admin.py`) : une contrainte de base ne peut
            # pas exprimer « il existe au moins une ligne enfant ».
            models.UniqueConstraint(
                fields=["question"],
                condition=models.Q(is_correct=True),
                name="choice_une_seule_bonne_reponse_par_question",
            )
        ]

    def __str__(self) -> str:
        return self.text


class Attempt(models.Model):
    """Une tentative de `user` sur `quiz`. `answers` ne stocke que ce que l'étudiant a
    choisi (`{question_id: choice_id}`) — jamais la correction, recalculée à chaque
    lecture depuis `Choice.is_correct`, seule source de vérité.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="attempts"
    )
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="attempts")
    started_at = models.DateTimeField(default=timezone.now)
    submitted_at = models.DateTimeField(null=True, blank=True)
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    passed = models.BooleanField(default=False)
    answers = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["user", "quiz"])]
        constraints = [
            # Au plus une tentative ouverte (non soumise) par (user, quiz), défendu en
            # base : `demarrer_tentative` s'appuie dessus (`except IntegrityError`) pour
            # rester correct sous deux requêtes concurrentes (double clic, deux onglets),
            # ce qu'un `SELECT ... FOR UPDATE` sur un ensemble vide ne peut pas garantir
            # à lui seul.
            models.UniqueConstraint(
                fields=["user", "quiz"],
                condition=models.Q(submitted_at__isnull=True),
                name="attempt_une_seule_ouverte_par_utilisateur_quiz",
            )
        ]

    def __str__(self) -> str:
        etat = self.score if self.score is not None else "en cours"
        return f"{self.user_id} — {self.quiz_id} ({etat})"

"""Fixtures des QCM : un quiz de chapitre et un examen de module, chacun avec deux
questions à deux choix (une bonne réponse par question)."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterator
from typing import cast

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.assessment.models import Attempt, Choice, Question, Quiz
from apps.catalog.models import Chapter, Course, Lesson, Module
from apps.enrollment.models import Enrollment

MOT_DE_PASSE = "un-mot-de-passe-solide-123"


@pytest.fixture(autouse=True)
def _cache_vide() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def cours(db: None) -> Course:
    return Course.objects.create(
        slug="flutter-firebase-debutants",
        title="Flutter + Firebase",
        description="Une vraie application.",
        is_published=True,
    )


@pytest.fixture
def module_0(cours: Course) -> Module:
    return Module.objects.create(course=cours, order=0, title="Mise en route")


@pytest.fixture
def chapitre_gratuit(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0, slug="installer-flutter", order=1, title="Installer Flutter", is_free=True
    )
    Lesson.objects.create(chapter=chapitre, duration_s=480, transcript="Contenu gratuit.")
    return chapitre


@pytest.fixture
def chapitre_payant(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0, slug="premier-widget", order=2, title="Premier widget", is_free=False
    )
    Lesson.objects.create(chapter=chapitre, duration_s=600, transcript="Contenu payant.")
    return chapitre


def _quiz_avec_questions(*, chapter: Chapter | None, module: Module | None) -> Quiz:
    quiz = Quiz.objects.create(
        chapter=chapter, module=module, pass_threshold=60, max_attempts=2, min_duration_s=5
    )
    for i in range(2):
        question = Question.objects.create(
            quiz=quiz,
            order=i + 1,
            text=f"Question {i + 1} ?",
            explanation=f"Explication {i + 1}.",
        )
        Choice.objects.create(question=question, order=1, text="Bonne réponse", is_correct=True)
        Choice.objects.create(question=question, order=2, text="Mauvaise réponse", is_correct=False)
    return quiz


@pytest.fixture
def quiz_chapitre(chapitre_gratuit: Chapter) -> Quiz:
    return _quiz_avec_questions(chapter=chapitre_gratuit, module=None)


@pytest.fixture
def quiz_chapitre_payant(chapitre_payant: Chapter) -> Quiz:
    return _quiz_avec_questions(chapter=chapitre_payant, module=None)


@pytest.fixture
def quiz_examen(module_0: Module) -> Quiz:
    return _quiz_avec_questions(chapter=None, module=module_0)


def bonnes_reponses(quiz: Quiz) -> dict[int, int]:
    """`{question_id: choice_id}` menant à un score de 100 % — pratique pour les tests
    qui ne portent pas sur la correction elle-même. Clés entières : c'est la forme que
    `services.soumettre_tentative` attend (le serializer de la vue fait la conversion
    depuis des clés JSON, forcément des chaînes ; ici on appelle parfois le service
    directement)."""
    return {q.id: next(c.id for c in q.choices.all() if c.is_correct) for q in quiz.questions.all()}


def mauvaises_reponses(quiz: Quiz) -> dict[int, int]:
    return {
        q.id: next(c.id for c in q.choices.all() if not c.is_correct)
        for q in quiz.questions.all()
    }


@pytest.fixture
def etudiante(db: None) -> User:
    return cast(
        User,
        User.objects.create_user(
            email="etudiante@example.com", phone="0550112233", password=MOT_DE_PASSE
        ),
    )


@pytest.fixture
def etudiant_b(db: None) -> User:
    return cast(
        User,
        User.objects.create_user(
            email="karim@example.com", phone="0660112233", password="un-autre-mot-de-passe-456"
        ),
    )


@pytest.fixture
def inscription_active(etudiante: User, cours: Course) -> Enrollment:
    return Enrollment.objects.create(user=etudiante, course=cours, status=Enrollment.Status.ACTIVE)


@pytest.fixture
def inscription_pending(etudiante: User, cours: Course) -> Enrollment:
    return Enrollment.objects.create(user=etudiante, course=cours, status=Enrollment.Status.PENDING)


def connecter(client: APIClient, user: User) -> APIClient:
    from apps.accounts.services import connecter as ouvrir_session

    mots = {
        "etudiante@example.com": MOT_DE_PASSE,
        "karim@example.com": "un-autre-mot-de-passe-456",
    }
    emise = ouvrir_session(
        email=user.email,
        password=mots[user.email],
        device_fingerprint="tests",
        ip_prefix="127.0.0",
    )
    client.cookies["access_token"] = emise.access_token
    return client


@pytest.fixture
def client_etudiante(etudiante: User) -> APIClient:
    return connecter(APIClient(), etudiante)


@pytest.fixture
def client_b(etudiant_b: User) -> APIClient:
    return connecter(APIClient(), etudiant_b)


def tentative_ancienne(*, user: User, quiz: Quiz, secondes: int = 3600) -> Attempt:
    """Une tentative ouverte depuis longtemps — évite d'attendre `min_duration_s` dans
    les tests qui ne portent pas sur l'anti-triche du chrono."""
    return Attempt.objects.create(
        user=user, quiz=quiz, started_at=timezone.now() - dt.timedelta(seconds=secondes)
    )

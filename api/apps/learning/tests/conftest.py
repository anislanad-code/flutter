"""Fixtures du pipeline : deux modules, chacun avec des chapitres payants et gratuits."""

from __future__ import annotations

from collections.abc import Iterator
from typing import cast

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User
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
def module_1(cours: Course) -> Module:
    return Module.objects.create(course=cours, order=1, title="Premiers écrans")


@pytest.fixture
def chapitre_0a(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0, slug="installer-flutter", order=1, title="Installer Flutter", is_free=True
    )
    Lesson.objects.create(chapter=chapitre, duration_s=480, transcript="Contenu gratuit.")
    return chapitre


@pytest.fixture
def chapitre_0b(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0, slug="premier-widget", order=2, title="Premier widget", is_free=False
    )
    Lesson.objects.create(chapter=chapitre, duration_s=600, transcript="Contenu payant.")
    return chapitre


@pytest.fixture
def chapitre_1a(module_1: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_1, slug="premier-ecran", order=1, title="Premier écran", is_free=False
    )
    Lesson.objects.create(chapter=chapitre, duration_s=500, transcript="Suite.")
    return chapitre


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

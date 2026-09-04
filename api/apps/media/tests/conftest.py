"""Fixtures de lecture vidéo."""

from __future__ import annotations

from collections.abc import Iterator
from typing import cast

import pytest
from django.core.cache import cache
from pytest_django.fixtures import SettingsWrapper
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course, Lesson, Module
from apps.enrollment.models import Enrollment

VIDEO_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
MOT_DE_PASSE = "un-mot-de-passe-solide-123"


@pytest.fixture(autouse=True)
def _cache_vide() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def bunny_configure(settings: SettingsWrapper) -> None:
    settings.BUNNY_TOKEN_AUTH_KEY = "cle-de-test-bunny-token-auth"
    settings.BUNNY_CDN_HOSTNAME = "vz-test.b-cdn.net"
    settings.BUNNY_LIBRARY_ID = "12345"
    settings.PLAYBACK_TOKEN_TTL_SECONDS = 300
    settings.PLAYBACK_RATE_LIMIT_BURST = 12
    settings.PLAYBACK_RATE_LIMIT_HOURLY = 80


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
def lecon_gratuite(module_0: Module) -> Lesson:
    chapitre = Chapter.objects.create(
        module=module_0, slug="installer-flutter", order=1, title="Installer Flutter", is_free=True
    )
    return Lesson.objects.create(
        chapter=chapitre,
        video_provider_id=VIDEO_ID,
        duration_s=480,
        transcript="Contenu gratuit.",
    )


@pytest.fixture
def lecon_sans_video(module_0: Module) -> Lesson:
    chapitre = Chapter.objects.create(
        module=module_0, slug="sans-video", order=3, title="Sans vidéo", is_free=True
    )
    return Lesson.objects.create(chapter=chapitre, video_provider_id="", duration_s=120)


@pytest.fixture
def lecon_payante(module_0: Module) -> Lesson:
    chapitre = Chapter.objects.create(
        module=module_0, slug="premier-widget", order=2, title="Premier widget", is_free=False
    )
    return Lesson.objects.create(
        chapter=chapitre,
        video_provider_id=VIDEO_ID,
        duration_s=600,
        transcript="Contenu payant.",
    )


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
def inscription_pending(etudiante: User, cours: Course) -> Enrollment:
    return Enrollment.objects.create(user=etudiante, course=cours, status=Enrollment.Status.PENDING)


def activer(user: User) -> None:
    Enrollment.objects.filter(user=user).update(status=Enrollment.Status.ACTIVE)


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

from __future__ import annotations

from collections.abc import Iterator

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.catalog.models import Chapter, Course, Lesson, Module


@pytest.fixture(autouse=True)
def _cache_videe() -> Iterator[None]:
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
        title="Flutter + Firebase pour débutants absolus",
        description="Une vraie application mobile, de zéro.",
        is_published=True,
    )


@pytest.fixture
def cours_non_publie(db: None) -> Course:
    return Course.objects.create(
        slug="brouillon",
        title="Formation en préparation",
        description="Pas encore publiée.",
        is_published=False,
    )


@pytest.fixture
def module_0(cours: Course) -> Module:
    return Module.objects.create(
        course=cours, order=0, title="Mise en route", summary="Installer l'outillage."
    )


@pytest.fixture
def chapitre_gratuit(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0,
        slug="installer-flutter",
        order=1,
        title="Installer Flutter et configurer ton éditeur",
        is_free=True,
    )
    Lesson.objects.create(
        chapter=chapitre,
        video_provider_id="",
        duration_s=480,
        transcript="Télécharge le SDK Flutter et vérifie l'installation avec flutter doctor.",
        resources=[{"titre": "flutter.dev", "url": "https://flutter.dev"}],
    )
    return chapitre


@pytest.fixture
def chapitre_payant(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0,
        slug="ton-premier-widget",
        order=2,
        title="Ton premier widget",
        is_free=False,
    )
    Lesson.objects.create(
        chapter=chapitre,
        video_provider_id="bunny-secret-id",
        duration_s=600,
        transcript="Contenu réservé aux inscrits actifs — ne doit jamais sortir de l'API publique.",
        resources=[],
    )
    return chapitre

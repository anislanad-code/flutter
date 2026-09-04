from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.catalog.models import Chapter, Course

pytestmark = pytest.mark.django_db


def test_seed_cree_la_formation_avec_le_chapitre_gratuit() -> None:
    call_command("seed_course")

    cours = Course.objects.get(slug="flutter-firebase-debutants")
    assert cours.is_published is True
    chapitre_libre = Chapter.objects.get(slug="installer-flutter-et-configurer-ton-editeur")
    assert chapitre_libre.is_free is True
    assert chapitre_libre.lesson.transcript


def test_seed_est_idempotent() -> None:
    call_command("seed_course")
    call_command("seed_course")

    assert Course.objects.filter(slug="flutter-firebase-debutants").count() == 1
    assert Chapter.objects.count() == 6

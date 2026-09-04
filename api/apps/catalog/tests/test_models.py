from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.catalog.models import Chapter, Course, Lead, Lesson, Module

pytestmark = pytest.mark.django_db


def test_deux_modules_ne_peuvent_pas_partager_le_meme_ordre(cours: Course) -> None:
    Module.objects.create(course=cours, order=0, title="Premier")
    with pytest.raises(IntegrityError), transaction.atomic():
        Module.objects.create(course=cours, order=0, title="Doublon")


def test_deux_chapitres_ne_peuvent_pas_partager_le_meme_ordre_dans_un_module(
    module_0: Module,
) -> None:
    Chapter.objects.create(module=module_0, slug="a", order=1, title="A")
    with pytest.raises(IntegrityError), transaction.atomic():
        Chapter.objects.create(module=module_0, slug="b", order=1, title="B")


def test_le_slug_de_chapitre_est_unique_globalement(cours: Course) -> None:
    module_1 = Module.objects.create(course=cours, order=0, title="M1")
    module_2 = Module.objects.create(course=cours, order=1, title="M2")
    Chapter.objects.create(module=module_1, slug="meme-slug", order=1, title="A")
    with pytest.raises(IntegrityError), transaction.atomic():
        Chapter.objects.create(module=module_2, slug="meme-slug", order=1, title="B")


def test_str_representations(cours: Course, module_0: Module) -> None:
    chapitre = Chapter.objects.create(module=module_0, slug="c", order=1, title="C")
    assert str(cours) == cours.title
    assert cours.slug in str(module_0)
    assert chapitre.title in str(chapitre)

    lecon = Lesson.objects.create(chapter=chapitre)
    assert str(chapitre) in str(lecon)

    lead = Lead.objects.create(email="a@example.com")
    assert str(lead) == "a@example.com"

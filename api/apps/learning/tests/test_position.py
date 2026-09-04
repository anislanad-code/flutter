from __future__ import annotations

from typing import cast

import pytest

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course, Lesson, Module
from apps.learning.models import Progress
from apps.learning.services import enregistrer_position, position_de

pytestmark = pytest.mark.django_db


@pytest.fixture
def etudiante() -> User:
    return cast(
        User,
        User.objects.create_user(
            email="etudiante@example.com",
            phone="0550112233",
            password="un-mot-de-passe-solide-123",
        ),
    )


@pytest.fixture
def chapitre() -> Chapter:
    cours = Course.objects.create(
        slug="flutter-firebase-debutants",
        title="Flutter + Firebase",
        description="",
        is_published=True,
    )
    module = Module.objects.create(course=cours, order=0, title="Mise en route")
    chapitre = Chapter.objects.create(
        module=module, slug="installer-flutter", order=1, title="Installer Flutter", is_free=True
    )
    Lesson.objects.create(chapter=chapitre, video_provider_id="", duration_s=480)
    return chapitre


def test_sans_progression_la_reprise_est_zero(etudiante: User, chapitre: Chapter) -> None:
    assert position_de(etudiante, chapitre) == 0


def test_premier_tick_a_zero_reste_not_started_puis_passe_en_cours(
    etudiante: User, chapitre: Chapter
) -> None:
    assert enregistrer_position(user=etudiante, chapter=chapitre, watched_s=0, duration_s=480) == 0
    progression = Progress.objects.get(user=etudiante, chapter=chapitre)
    assert progression.state == Progress.State.NOT_STARTED

    assert (
        enregistrer_position(user=etudiante, chapter=chapitre, watched_s=12, duration_s=480) == 12
    )
    progression.refresh_from_db()
    assert progression.state == Progress.State.IN_PROGRESS
    assert progression.watched_s == 12
    assert position_de(etudiante, chapitre) == 12


def test_str_de_progress_identifie_user_et_chapitre(etudiante: User, chapitre: Chapter) -> None:
    progression = Progress.objects.create(user=etudiante, chapter=chapitre)
    assert str(progression) == f"{etudiante.pk} — chapitre {chapitre.pk} (NOT_STARTED)"


def test_duree_nulle_ne_borne_pas_et_negatif_devient_zero(
    etudiante: User, chapitre: Chapter
) -> None:
    assert enregistrer_position(user=etudiante, chapter=chapitre, watched_s=99, duration_s=0) == 99
    assert Progress.objects.get(user=etudiante, chapter=chapitre).watched_s == 99
    assert enregistrer_position(user=etudiante, chapter=chapitre, watched_s=-8, duration_s=480) == 0
    assert Progress.objects.get(user=etudiante, chapter=chapitre).watched_s == 0


def test_une_course_get_or_create_ne_leve_pas(
    etudiante: User, chapitre: Chapter, monkeypatch: pytest.MonkeyPatch
) -> None:
    from django.db import IntegrityError

    Progress.objects.create(user=etudiante, chapter=chapitre, watched_s=3)

    def _boom(*args: object, **kwargs: object) -> tuple[Progress, bool]:
        raise IntegrityError("progress_unique_user_chapitre")

    monkeypatch.setattr(Progress.objects, "get_or_create", _boom)
    assert enregistrer_position(user=etudiante, chapter=chapitre, watched_s=9, duration_s=480) == 9
    assert Progress.objects.get(user=etudiante, chapter=chapitre).watched_s == 9

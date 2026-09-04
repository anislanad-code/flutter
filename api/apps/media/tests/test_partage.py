from __future__ import annotations

import pytest
from pytest_django.fixtures import SettingsWrapper
from rest_framework.response import Response
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.catalog.models import Lesson
from apps.enrollment.models import Enrollment
from apps.media.tests.conftest import activer

pytestmark = pytest.mark.django_db


def _poster(
    client: APIClient,
    lecon: Lesson,
    *,
    ip: str = "203.0.113.10",
    empreinte: str = "appareil-a",
) -> Response:
    return client.post(
        f"/api/lessons/{lecon.pk}/playback",
        {},
        format="json",
        HTTP_X_FORWARDED_FOR=ip,
        HTTP_X_DEVICE_FINGERPRINT=empreinte,
    )


def test_trop_de_jetons_par_heure_flague_sans_couper(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
    settings: SettingsWrapper,
) -> None:
    activer(etudiante)
    settings.PLAYBACK_FLAG_TOKENS_PER_HOUR = 2
    settings.PLAYBACK_RATE_LIMIT_BURST = 50
    settings.PLAYBACK_RATE_LIMIT_HOURLY = 50

    assert _poster(client_etudiante, lecon_payante, empreinte="a").status_code == 200
    assert _poster(client_etudiante, lecon_payante, empreinte="a").status_code == 200
    troisieme = _poster(client_etudiante, lecon_payante, empreinte="a")

    assert troisieme.status_code == 200
    assert troisieme.data["disponible"] is True
    etudiante.refresh_from_db()
    assert etudiante.flagged_for_review is True
    assert etudiante.is_active is True
    assert AuditLog.objects.filter(
        action=AuditLog.Action.PLAYBACK_FLAGGED, target_id=str(etudiante.pk)
    ).exists()


def test_flag_deja_pose_ne_journalise_pas_en_double(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
    settings: SettingsWrapper,
) -> None:
    activer(etudiante)
    settings.PLAYBACK_FLAG_TOKENS_PER_HOUR = 1
    settings.PLAYBACK_RATE_LIMIT_BURST = 50
    settings.PLAYBACK_RATE_LIMIT_HOURLY = 50

    _poster(client_etudiante, lecon_payante, empreinte="a")
    _poster(client_etudiante, lecon_payante, empreinte="a")
    _poster(client_etudiante, lecon_payante, empreinte="a")

    assert AuditLog.objects.filter(action=AuditLog.Action.PLAYBACK_FLAGGED).count() == 1


def test_trop_de_prefixes_ip_flague(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
    settings: SettingsWrapper,
) -> None:
    activer(etudiante)
    settings.PLAYBACK_FLAG_IP_PREFIXES_PER_HOUR = 1
    settings.PLAYBACK_RATE_LIMIT_BURST = 50
    settings.PLAYBACK_RATE_LIMIT_HOURLY = 50

    assert _poster(client_etudiante, lecon_payante, ip="203.0.113.10").status_code == 200
    assert _poster(client_etudiante, lecon_payante, ip="198.51.100.20").status_code == 200

    etudiante.refresh_from_db()
    assert etudiante.flagged_for_review is True


def test_trop_d_empreintes_sur_7_jours_flague(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
    settings: SettingsWrapper,
) -> None:
    activer(etudiante)
    settings.PLAYBACK_FLAG_FINGERPRINTS_7D = 1
    settings.PLAYBACK_RATE_LIMIT_BURST = 50
    settings.PLAYBACK_RATE_LIMIT_HOURLY = 50

    _poster(client_etudiante, lecon_payante, empreinte="un")
    _poster(client_etudiante, lecon_payante, empreinte="deux")

    etudiante.refresh_from_db()
    assert etudiante.flagged_for_review is True


def test_empreintes_vides_ne_comptent_pas_pour_le_seuil_7j(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
    settings: SettingsWrapper,
) -> None:
    activer(etudiante)
    settings.PLAYBACK_FLAG_FINGERPRINTS_7D = 1
    settings.PLAYBACK_RATE_LIMIT_BURST = 50
    settings.PLAYBACK_RATE_LIMIT_HOURLY = 50

    assert _poster(client_etudiante, lecon_payante, empreinte="").status_code == 200
    assert _poster(client_etudiante, lecon_payante, empreinte="").status_code == 200

    etudiante.refresh_from_db()
    assert etudiante.flagged_for_review is False


def test_le_rate_limit_d_emission_renvoie_429(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
    settings: SettingsWrapper,
) -> None:
    activer(etudiante)
    settings.PLAYBACK_RATE_LIMIT_BURST = 3
    settings.PLAYBACK_FLAG_TOKENS_PER_HOUR = 100

    assert _poster(client_etudiante, lecon_payante).status_code == 200
    assert _poster(client_etudiante, lecon_payante).status_code == 200
    assert _poster(client_etudiante, lecon_payante).status_code == 200
    quatrieme = _poster(client_etudiante, lecon_payante)

    assert quatrieme.status_code == 429
    assert quatrieme.data["detail"] == "Trop de tentatives. Réessaie plus tard."

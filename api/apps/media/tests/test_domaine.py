"""Modèles, admin Django et libellé de filigrane — aucune URL signée n'y figure."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.http import Http404
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Lesson
from apps.enrollment.models import Enrollment
from apps.media.models import PlaybackToken
from apps.media.services import lecture_refusee_en_404, libelle_filigrane
from apps.media.tests.conftest import activer

pytestmark = pytest.mark.django_db


def test_str_du_jeton_ne_contient_pas_d_url(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
) -> None:
    activer(etudiante)
    reponse = client_etudiante.post(
        f"/api/lessons/{lecon_payante.pk}/playback",
        {},
        format="json",
        HTTP_X_FORWARDED_FOR="203.0.113.10",
        HTTP_X_DEVICE_FINGERPRINT="appareil-a",
    )
    jeton = PlaybackToken.objects.get(pk=reponse.data["playback_id"])
    libelle = str(jeton)
    assert str(jeton.id) in libelle
    assert str(lecon_payante.pk) in libelle
    assert "bcdn_token" not in libelle
    assert "b-cdn" not in libelle
    assert reponse.data["playback_url"] not in libelle


def test_est_actif_refuse_un_jeton_consomme_ou_expire(lecon_gratuite: Lesson) -> None:
    maintenant = timezone.now()
    vivant = PlaybackToken.objects.create(
        user=None,
        lesson=lecon_gratuite,
        issued_at=maintenant,
        expires_at=maintenant + timedelta(minutes=5),
        ip_prefix="203.0.113",
        consumed=False,
    )
    assert vivant.est_actif() is True

    vivant.consumed = True
    vivant.save(update_fields=["consumed"])
    assert vivant.est_actif() is False

    expire = PlaybackToken.objects.create(
        user=None,
        lesson=lecon_gratuite,
        issued_at=maintenant,
        expires_at=maintenant - timedelta(seconds=1),
        ip_prefix="203.0.113",
        consumed=False,
    )
    assert expire.est_actif() is False


def test_libelle_filigrane_visiteur_et_telephone_court(etudiante: User) -> None:
    assert libelle_filigrane(None) == "visiteur"
    etudiante.phone = "ab12"
    assert libelle_filigrane(etudiante) == "etudiante · ----"
    etudiante.phone = "+213 555 11 22 33"
    assert libelle_filigrane(etudiante) == "etudiante · 2233"


def test_lecture_refusee_est_un_404_muet() -> None:
    erreur = lecture_refusee_en_404()
    assert isinstance(erreur, Http404)
    assert str(erreur) == ""


def test_l_admin_django_interdit_d_ajouter_ou_modifier_un_jeton() -> None:
    from django.contrib import admin as django_admin

    from apps.media.admin import PlaybackTokenAdmin

    interface = PlaybackTokenAdmin(PlaybackToken, django_admin.site)

    assert interface.has_add_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_change_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_change_permission(None, obj=PlaybackToken()) is False  # type: ignore[arg-type]
    assert interface.has_delete_permission(None) is False  # type: ignore[arg-type]

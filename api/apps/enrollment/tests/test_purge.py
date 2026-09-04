"""Purge des preuves 90 jours après examen (CLAUDE.md §4.5)."""

from __future__ import annotations

import datetime as dt
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.services import DELAI_PURGE, purger_preuves_echues
from apps.enrollment.storage import PreuveIllisibleError, stockage_preuves

pytestmark = pytest.mark.django_db


def _preuve(inscription: Enrollment, purge_after: dt.datetime | None) -> PaymentProof:
    stockage = stockage_preuves()
    cle = stockage.nouvelle_cle()
    stockage.ecrire(cle, b"contenu du recu")
    return PaymentProof.objects.create(
        enrollment=inscription,
        file_key=cle,
        content_type="image/jpeg",
        byte_size=15,
        amount_declared=12000,
        status=PaymentProof.Status.ACCEPTED,
        purge_after=purge_after,
    )


def test_le_delai_est_bien_de_quatre_vingt_dix_jours() -> None:
    assert DELAI_PURGE == dt.timedelta(days=90)


def test_une_preuve_echue_perd_son_fichier_mais_garde_sa_trace(
    inscription: Enrollment, stockage_temporaire: Path
) -> None:
    preuve = _preuve(inscription, timezone.now() - dt.timedelta(days=1))

    assert purger_preuves_echues() == 1

    preuve.refresh_from_db()
    assert preuve.purged_at is not None
    assert preuve.status == PaymentProof.Status.ACCEPTED
    assert preuve.amount_declared == 12000
    assert not (stockage_temporaire / f"{preuve.file_key}.bin").exists()
    with pytest.raises(PreuveIllisibleError):
        stockage_preuves().lire(preuve.file_key)


def test_une_preuve_non_echue_n_est_pas_touchee(
    inscription: Enrollment, stockage_temporaire: Path
) -> None:
    preuve = _preuve(inscription, timezone.now() + dt.timedelta(days=1))

    assert purger_preuves_echues() == 0

    preuve.refresh_from_db()
    assert preuve.purged_at is None
    assert stockage_preuves().lire(preuve.file_key) == b"contenu du recu"


def test_une_preuve_jamais_examinee_n_est_pas_purgee(
    inscription: Enrollment, stockage_temporaire: Path
) -> None:
    """`purge_after` nul = reçu toujours en attente : le détruire couperait le dossier."""
    preuve = _preuve(inscription, None)
    preuve.status = PaymentProof.Status.SUBMITTED
    preuve.save(update_fields=["status"])

    assert purger_preuves_echues() == 0

    preuve.refresh_from_db()
    assert preuve.purged_at is None


def test_la_purge_est_journalisee_sans_acteur(
    inscription: Enrollment, stockage_temporaire: Path
) -> None:
    _preuve(inscription, timezone.now() - dt.timedelta(days=1))

    purger_preuves_echues()

    entree = AuditLog.objects.get(action=AuditLog.Action.PROOF_PURGED)
    assert entree.actor is None


def test_la_purge_est_idempotente(inscription: Enrollment, stockage_temporaire: Path) -> None:
    _preuve(inscription, timezone.now() - dt.timedelta(days=1))

    assert purger_preuves_echues() == 1
    assert purger_preuves_echues() == 0
    assert AuditLog.objects.filter(action=AuditLog.Action.PROOF_PURGED).count() == 1


def test_la_commande_de_gestion_purge_et_rend_compte(
    inscription: Enrollment, stockage_temporaire: Path
) -> None:
    _preuve(inscription, timezone.now() - dt.timedelta(days=1))
    sortie = StringIO()

    call_command("purger_preuves", stdout=sortie)

    assert "1 preuve(s) purgée(s)." in sortie.getvalue()


def test_la_purge_survit_a_un_fichier_deja_absent(
    inscription: Enrollment, stockage_temporaire: Path
) -> None:
    """Un fichier effacé à la main ne doit pas bloquer la purge des suivants."""
    preuve = _preuve(inscription, timezone.now() - dt.timedelta(days=1))
    (stockage_temporaire / f"{preuve.file_key}.bin").unlink()

    assert purger_preuves_echues() == 1

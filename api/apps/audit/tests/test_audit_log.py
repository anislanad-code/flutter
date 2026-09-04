"""Journal d'audit : immuable, jamais bavard (CLAUDE.md §4.6, checklist §8 point 10)."""

from __future__ import annotations

from typing import cast

import pytest

from apps.accounts.models import User
from apps.audit.models import AuditLog, AuditLogImmuableError
from apps.audit.services import journaliser

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(db: None) -> User:
    return cast(
        User,
        User.objects.create_user(email="anis@example.com", password="mot-de-passe-admin-789"),
    )


def test_journaliser_ecrit_une_entree(admin: User) -> None:
    entree = journaliser(
        actor=admin,
        action=AuditLog.Action.ENROLLMENT_ACCEPTED,
        target_type="Enrollment",
        target_id=42,
        metadata={"user_id": 7},
    )

    assert entree.pk is not None
    assert entree.actor_id == admin.pk
    assert entree.target_id == "42"
    assert entree.metadata == {"user_id": 7}


def test_une_entree_ecrite_ne_peut_plus_etre_modifiee(admin: User) -> None:
    entree = journaliser(
        actor=admin, action=AuditLog.Action.PROOF_VIEWED, target_type="PaymentProof", target_id=1
    )

    entree.action = AuditLog.Action.PROOF_PURGED
    with pytest.raises(AuditLogImmuableError):
        entree.save()

    entree.refresh_from_db()
    assert entree.action == AuditLog.Action.PROOF_VIEWED


def test_une_entree_relue_depuis_la_base_ne_peut_pas_etre_reecrite(admin: User) -> None:
    journaliser(
        actor=admin, action=AuditLog.Action.PROOF_VIEWED, target_type="PaymentProof", target_id=1
    )
    relue = AuditLog.objects.get()

    with pytest.raises(AuditLogImmuableError):
        relue.save()


def test_une_entree_ne_peut_pas_etre_supprimee(admin: User) -> None:
    entree = journaliser(
        actor=admin, action=AuditLog.Action.PROOF_VIEWED, target_type="PaymentProof", target_id=1
    )

    with pytest.raises(AuditLogImmuableError):
        entree.delete()

    assert AuditLog.objects.count() == 1


def test_supprimer_l_acteur_conserve_la_trace(admin: User) -> None:
    """Effacer un compte admin ne doit pas effacer ce qu'il a fait."""
    journaliser(
        actor=admin,
        action=AuditLog.Action.ENROLLMENT_ACCEPTED,
        target_type="Enrollment",
        target_id=1,
    )

    admin.delete()

    entree = AuditLog.objects.get()
    assert entree.actor is None
    assert entree.action == AuditLog.Action.ENROLLMENT_ACCEPTED


def test_str_ne_contient_pas_les_metadonnees(admin: User) -> None:
    entree = journaliser(
        actor=admin,
        action=AuditLog.Action.PROOF_VIEWED,
        target_type="PaymentProof",
        target_id="abc",
        metadata={"path": "/api/admin/proofs/x/file?signature=secret"},
    )

    assert "signature=secret" not in str(entree)
    assert "PROOF_VIEWED" in str(entree)


def test_l_interface_d_administration_interdit_ajout_modification_et_suppression() -> None:
    from django.contrib import admin as django_admin

    from apps.audit.admin import AuditLogAdmin

    interface = AuditLogAdmin(AuditLog, django_admin.site)

    assert interface.has_add_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_change_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_delete_permission(None) is False  # type: ignore[arg-type]

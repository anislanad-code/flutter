"""Modèles, admin Django, fournisseurs et emails de l'inscription payante."""

from __future__ import annotations

import pytest
from django.core import mail

from apps.accounts.models import User
from apps.enrollment.emails import (
    envoyer_email_compte_active,
    envoyer_email_preuve_recue,
    envoyer_email_preuve_refusee,
)
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.providers import ManualCCPProvider, fournisseur_actif, reference_versement

pytestmark = pytest.mark.django_db


def test_donne_acces_au_contenu_uniquement_si_active() -> None:
    # Instances non persistées : mypy suit le `status` du constructeur, pas une
    # mutation en mémoire d'une fixture typée PENDING (sinon `is True` est unreachable).
    assert Enrollment(status=Enrollment.Status.PENDING).donne_acces_au_contenu is False
    assert Enrollment(status=Enrollment.Status.ACTIVE).donne_acces_au_contenu is True
    assert Enrollment(status=Enrollment.Status.BLOCKED).donne_acces_au_contenu is False
    assert Enrollment(status=Enrollment.Status.EXPIRED).donne_acces_au_contenu is False


def test_une_preuve_purgee_n_est_plus_lisible(inscription: Enrollment) -> None:
    from django.utils import timezone

    preuve = PaymentProof.objects.create(
        enrollment=inscription,
        file_key="a" * 32,
        content_type="image/jpeg",
        byte_size=12,
        amount_declared=12000,
    )
    assert preuve.est_lisible is True

    preuve.purged_at = timezone.now()
    assert preuve.est_lisible is False


def test_str_des_modeles_ne_fuit_pas_la_cle_de_stockage(inscription: Enrollment) -> None:
    preuve = PaymentProof.objects.create(
        enrollment=inscription,
        file_key="a" * 32,
        content_type="image/jpeg",
        byte_size=12,
        amount_declared=12000,
    )

    assert "a" * 32 not in str(preuve)
    assert str(inscription.status) in str(inscription)


def test_l_admin_django_interdit_d_ajouter_ou_modifier_une_preuve() -> None:
    from django.contrib import admin as django_admin

    from apps.enrollment.admin import PaymentProofAdmin

    interface = PaymentProofAdmin(PaymentProof, django_admin.site)

    assert interface.has_add_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_change_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_delete_permission(None) is False  # type: ignore[arg-type]


def test_l_admin_django_ne_peut_pas_activer_une_inscription_hors_pipeline() -> None:
    from django.contrib import admin as django_admin

    from apps.enrollment.admin import EnrollmentAdmin

    interface = EnrollmentAdmin(Enrollment, django_admin.site)

    assert interface.has_add_permission(None) is False  # type: ignore[arg-type]
    assert interface.has_delete_permission(None) is False  # type: ignore[arg-type]
    assert "status" in interface.readonly_fields
    assert "user" in interface.readonly_fields
    assert "note_admin" not in interface.readonly_fields


def test_le_fournisseur_actif_est_le_ccp_manuel() -> None:
    fournisseur = fournisseur_actif()

    assert isinstance(fournisseur, ManualCCPProvider)
    assert fournisseur.code == "MANUAL_CCP"
    assert reference_versement(42) == "ANISDEV-000042"


def test_les_emails_ne_contiennent_ni_token_ni_url_signee_ni_fichier(
    etudiante: User,
) -> None:
    """§4.6 : un email traverse des serveurs qu'on ne maîtrise pas."""
    envoyer_email_preuve_recue(etudiante)
    envoyer_email_compte_active(etudiante)
    envoyer_email_preuve_refusee(etudiante, "Le montant n'est pas lisible.")

    assert len(mail.outbox) == 3
    for message in mail.outbox:
        corps = message.body.lower()
        assert "signature=" not in corps
        assert "access_token" not in corps
        assert "file_key" not in corps
        assert b"%pdf" not in message.body.encode()
        assert not message.attachments

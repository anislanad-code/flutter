"""Représentation textuelle et invariantes de forme des modèles de l'étape 1.

Les `__str__` ne sont pas cosmétiques : ils s'affichent dans l'admin Django, qui est le
filet de sécurité du projet (CLAUDE.md §2). Ce qu'on vérifie ici, c'est surtout qu'aucun
d'eux ne laisse fuiter un secret — hachage de refresh, hachage de jeton de reset ou mot
de passe — dans une interface ou un journal.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import PasswordResetToken, Session, User
from apps.enrollment.models import Enrollment

pytestmark = pytest.mark.django_db


def test_le_str_d_un_utilisateur_est_son_email(utilisateur: User) -> None:
    assert str(utilisateur) == "etudiante@example.com"
    assert utilisateur.password not in str(utilisateur)


def test_le_str_d_une_session_ne_contient_pas_le_hachage_du_refresh(utilisateur: User) -> None:
    session = Session.objects.create(
        user=utilisateur,
        refresh_token_hash="a" * 64,
        expires_at=timezone.now() + timedelta(days=7),
    )

    rendu = str(session)
    assert rendu == f"session {session.id} — {utilisateur.id}"
    assert "a" * 64 not in rendu


def test_le_str_d_un_jeton_de_reset_ne_contient_pas_le_hachage(utilisateur: User) -> None:
    jeton = PasswordResetToken.objects.create(
        user=utilisateur,
        token_hash="b" * 64,
        expires_at=timezone.now() + timedelta(minutes=30),
    )

    rendu = str(jeton)
    assert rendu == f"reset {jeton.id} — {utilisateur.id}"
    assert "b" * 64 not in rendu


def test_le_str_d_un_enrollment_donne_l_utilisateur_et_le_statut(utilisateur: User) -> None:
    inscription = Enrollment.objects.create(user=utilisateur)

    assert str(inscription) == f"{utilisateur.id} — PENDING"


def test_les_identifiants_de_session_et_de_reset_sont_des_uuid(utilisateur: User) -> None:
    """Un identifiant séquentiel permettrait d'énumérer les sessions des autres comptes."""
    session = Session.objects.create(
        user=utilisateur,
        refresh_token_hash="c" * 64,
        expires_at=timezone.now() + timedelta(days=7),
    )
    jeton = PasswordResetToken.objects.create(
        user=utilisateur,
        token_hash="d" * 64,
        expires_at=timezone.now() + timedelta(minutes=30),
    )

    assert isinstance(session.pk, uuid.UUID)
    assert isinstance(jeton.pk, uuid.UUID)


def test_is_valid_couvre_expiration_et_revocation(utilisateur: User) -> None:
    passee = timezone.now() - timedelta(seconds=1)
    future = timezone.now() + timedelta(days=1)

    assert Session(user=utilisateur, expires_at=future).is_valid() is True
    assert Session(user=utilisateur, expires_at=passee).is_valid() is False
    assert (
        Session(user=utilisateur, expires_at=future, revoked_at=timezone.now()).is_valid() is False
    )

    assert PasswordResetToken(user=utilisateur, expires_at=future).is_valid() is True
    assert PasswordResetToken(user=utilisateur, expires_at=passee).is_valid() is False
    assert (
        PasswordResetToken(user=utilisateur, expires_at=future, used_at=timezone.now()).is_valid()
        is False
    )


def test_l_email_est_unique(utilisateur: User) -> None:
    from django.db import IntegrityError, transaction

    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(email=utilisateur.email, password="un-autre-mot-de-passe")

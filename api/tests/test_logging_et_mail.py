"""Rédaction des secrets dans les journaux et les emails console (CLAUDE.md §4.6)."""

from __future__ import annotations

import io
import logging

from django.core.mail import EmailMessage

from config.logging_filters import RedactSecretsFilter, rediger_secrets
from config.mail import RedactingConsoleEmailBackend


def test_une_signature_en_query_string_est_masquee() -> None:
    ligne = (
        "GET /api/admin/proofs/f8938379-9cc4-45fc-ba4f-4f546c56ed21/file"
        "?expires=1788537365&signature="
        "8abca03ac28fe3eee3f081a1d3f31b233871447d6d176dc6aa12df615a2d59c3 HTTP/1.1"
    )

    masque = rediger_secrets(ligne)

    assert "signature=***" in masque
    assert "8abca03ac28fe3eee3f081a1d3f31b233871447d6d176dc6aa12df615a2d59c3" not in masque
    assert "expires=1788537365" in masque


def test_un_jeton_de_reset_est_masque() -> None:
    corps = "http://localhost:3000/nouveau-mot-de-passe?token=3GePJN6bZxBoNXMAvkm5MV6U6KLMpJsqHq7iJ40TIe0"

    masque = rediger_secrets(corps)

    assert "token=***" in masque
    assert "3GePJN6bZxBoNXMAvkm5MV6U6KLMpJsqHq7iJ40TIe0" not in masque


def test_le_filtre_redige_un_mapping_d_arguments() -> None:
    record = logging.LogRecord(
        name="django.server",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="%(path)s",
        args=None,
        exc_info=None,
    )
    record.args = {"path": "/file?token=abcdef0123456789"}

    assert RedactSecretsFilter().filter(record) is True
    assert "abcdef0123456789" not in record.getMessage()
    assert "token=***" in record.getMessage()


def test_le_filtre_redige_les_arguments_du_logger_django_server() -> None:
    """`django.server` journalise via `format % args`, pas un message déjà interpolé."""
    record = logging.LogRecord(
        name="django.server",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='"%s" %s %s',
        args=(
            "GET /file?signature=abcdef0123456789 HTTP/1.1",
            "200",
            "296",
        ),
        exc_info=None,
    )

    assert RedactSecretsFilter().filter(record) is True
    assert "abcdef0123456789" not in record.getMessage()
    assert "signature=***" in record.getMessage()


def test_le_backend_console_n_imprime_pas_le_jeton() -> None:
    flux = io.StringIO()
    backend = RedactingConsoleEmailBackend(stream=flux)
    message = EmailMessage(
        subject="Réinitialise ton mot de passe",
        body="Ouvre http://localhost:3000/nouveau-mot-de-passe?token=super-secret-de-reset",
        from_email="contact@anis.dev",
        to=["sara@example.com"],
    )

    backend.send_messages([message])

    imprime = flux.getvalue()
    assert "token=***" in imprime
    assert "super-secret-de-reset" not in imprime

"""Filtres de journalisation : aucun secret dans stdout (CLAUDE.md §4.6)."""

from __future__ import annotations

import logging
import re

# Query strings et corps d'email : token de reset, HMAC des preuves.
_SECRETS = re.compile(
    r"(?i)((?:signature|token)=)[^\s&\"'<>]+",
)


def rediger_secrets(texte: str) -> str:
    return _SECRETS.sub(r"\1***", texte)


class RedactSecretsFilter(logging.Filter):
    """Appliqué au handler console : la query string d'un GET n'atteint jamais le disque."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = rediger_secrets(str(record.msg))
        if isinstance(record.args, dict):
            record.args = {
                cle: rediger_secrets(valeur) if isinstance(valeur, str) else valeur
                for cle, valeur in record.args.items()
            }
        elif isinstance(record.args, tuple):
            record.args = tuple(
                rediger_secrets(arg) if isinstance(arg, str) else arg for arg in record.args
            )
        return True

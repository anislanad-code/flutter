"""Filtres de journalisation : aucun secret dans stdout (CLAUDE.md §4.6)."""

from __future__ import annotations

import logging
import re

# Query strings et corps d'email : token de reset, HMAC des preuves, jetons Bunny.
_SECRETS = re.compile(
    r"(?i)((?:signature|token|token_path|bcdn_token)=)[^\s&\"'<>]+",
)
_URL_CDN = re.compile(
    r"https?://[^\s\"']+(?:\.b-cdn\.net|iframe\.mediadelivery\.net)[^\s\"']*",
    re.IGNORECASE,
)


def rediger_secrets(texte: str) -> str:
    masque = _SECRETS.sub(r"\1***", texte)
    return _URL_CDN.sub("https://***", masque)


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

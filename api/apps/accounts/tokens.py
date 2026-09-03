"""Émission et vérification des tokens (§4.2). Aucun JWT : signature Django + secrets aléatoires.

Un access token est court (15 min), signé et lié à la session : sa validité est revérifiée
en base à chaque requête pour que la révocation (déconnexion, reset de mot de passe) soit
immédiate, pas seulement au prochain refresh.

Un refresh token est `"<session_id>.<secret>"` : le secret est haute entropie, son hachage
SHA-256 seul est stocké (voir `models.py`). Le token en clair n'est jamais journalisé.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from django.conf import settings
from django.core import signing
from django.utils import timezone

ACCESS_TOKEN_SALT = "apps.accounts.access-token"  # noqa: S105 — sel de signature, pas un secret


@dataclass(frozen=True)
class AccessTokenPayload:
    user_id: int
    session_id: UUID


def issue_access_token(user_id: int, session_id: UUID) -> str:
    # "jti" (nonce) : deux émissions dans la même seconde produiraient sinon un token
    # identique, la signature étant déterministe pour un même payload + même timestamp.
    return signing.dumps(
        {"uid": user_id, "sid": str(session_id), "jti": secrets.token_urlsafe(6)},
        salt=ACCESS_TOKEN_SALT,
    )


def read_access_token(token: str) -> AccessTokenPayload | None:
    try:
        data = signing.loads(
            token,
            salt=ACCESS_TOKEN_SALT,
            max_age=settings.ACCESS_TOKEN_TTL_SECONDS,
        )
        return AccessTokenPayload(user_id=int(data["uid"]), session_id=UUID(data["sid"]))
    except (signing.BadSignature, KeyError, ValueError, TypeError):
        return None


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def generate_refresh_secret() -> str:
    return secrets.token_urlsafe(32)


def build_refresh_cookie_value(session_id: UUID, secret: str) -> str:
    return f"{session_id}.{secret}"


def parse_refresh_cookie_value(value: str) -> tuple[UUID, str] | None:
    if "." not in value:
        return None
    raw_id, secret = value.split(".", 1)
    try:
        return UUID(raw_id), secret
    except ValueError:
        return None


def refresh_expiry() -> datetime:
    return timezone.now() + timedelta(seconds=settings.REFRESH_TOKEN_TTL_SECONDS)


def generate_reset_secret() -> str:
    return secrets.token_urlsafe(32)


def reset_token_expiry() -> datetime:
    return timezone.now() + timedelta(seconds=settings.PASSWORD_RESET_TOKEN_TTL_SECONDS)

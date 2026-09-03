"""Authentification par cookie httpOnly relayé par Next (§4.2 — jamais de JWT en localStorage)."""

from __future__ import annotations

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.request import Request

from apps.accounts.models import Session, User
from apps.accounts.tokens import read_access_token


class CookieAccessTokenAuthentication(BaseAuthentication):
    """Lit `access_token` dans les cookies, vérifie la signature et que la session tient
    toujours (revoked_at IS NULL) — pour qu'une déconnexion coupe l'accès immédiatement,
    pas seulement au prochain refresh.
    """

    def authenticate(self, request: Request) -> tuple[User, None] | None:
        raw_token = request.COOKIES.get("access_token")
        if not raw_token:
            return None

        payload = read_access_token(raw_token)
        if payload is None:
            raise AuthenticationFailed("Session invalide ou expirée.")

        session = (
            Session.objects.filter(pk=payload.session_id, user_id=payload.user_id)
            .select_related("user")
            .first()
        )
        if session is None or not session.is_valid():
            raise AuthenticationFailed("Session invalide ou expirée.")

        user = session.user
        if not user.is_active:
            raise AuthenticationFailed("Compte désactivé.")

        User.objects.filter(pk=user.pk).update(last_activity_at=timezone.now())
        return user, None

    def authenticate_header(self, request: Request) -> str:
        # Sans ceci, DRF renvoie 403 sur un cookie invalide au lieu de 401 (pas de defi
        # WWW-Authenticate déclaré = "l'utilisateur est authentifié mais pas autorisé").
        return "Cookie"

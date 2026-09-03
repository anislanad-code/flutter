"""Logique métier de l'authentification (CLAUDE.md §7 : jamais dans les vues).

Chaque fonction qui change un état (création de compte, rotation de refresh, reset de mot
de passe) s'exécute dans une transaction atomique.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.emails import envoyer_email_bienvenue, envoyer_email_reinitialisation
from apps.accounts.models import PasswordResetToken, Session, User
from apps.accounts.tokens import (
    build_refresh_cookie_value,
    generate_refresh_secret,
    generate_reset_secret,
    hash_secret,
    issue_access_token,
    parse_refresh_cookie_value,
    refresh_expiry,
    reset_token_expiry,
)
from apps.enrollment.models import Enrollment

# Hachage constant comparé quand l'utilisateur n'existe pas, pour que la durée d'un
# échec « mauvais mot de passe » et d'un échec « compte inconnu » soit la même (§4.2).
_HACHAGE_FICTIF = make_password("mot-de-passe-de-reference-anti-enumeration")


class IdentifiantsInvalidesError(Exception):
    """Email ou mot de passe incorrect. Message et forme identiques dans les deux cas."""


class MotDePasseInvalideError(Exception):
    def __init__(self, erreurs: list[str]) -> None:
        self.erreurs = erreurs
        super().__init__("Mot de passe invalide.")


class JetonInvalideError(Exception):
    """Refresh token ou jeton de réinitialisation absent, expiré ou déjà utilisé."""


@dataclass(frozen=True)
class SessionEmise:
    access_token: str
    refresh_token: str
    access_ttl: int
    refresh_ttl: int
    user: User


def _emettre_session(user: User, device_fingerprint: str, ip_prefix: str) -> SessionEmise:
    from django.conf import settings

    secret = generate_refresh_secret()
    session = Session.objects.create(
        user=user,
        refresh_token_hash=hash_secret(secret),
        device_fingerprint=device_fingerprint[:255],
        ip_prefix=ip_prefix,
        expires_at=refresh_expiry(),
    )
    access = issue_access_token(user.id, session.id)
    refresh = build_refresh_cookie_value(session.id, secret)
    return SessionEmise(
        access_token=access,
        refresh_token=refresh,
        access_ttl=settings.ACCESS_TOKEN_TTL_SECONDS,
        refresh_ttl=settings.REFRESH_TOKEN_TTL_SECONDS,
        user=user,
    )


@transaction.atomic
def enregistrer(*, email: str, phone: str, password: str) -> None:
    """Crée le compte + un `Enrollment` PENDING.

    Ne renvoie jamais d'indication sur l'existence préalable de l'email (§4.2) : la vue
    répond toujours la même chose. Volontairement, cette fonction n'émet **pas** de
    session — si l'email appartenait déjà à quelqu'un d'autre, créer une session ici
    connecterait l'appelant sur le compte d'un tiers. L'appelant (la vue / le BFF)
    enchaîne un `connecter()` avec les mêmes identifiants : ça ne réussit que si le
    compte vient vraiment d'être créé avec ce mot de passe.
    """
    email_normalise = email.strip().lower()

    try:
        validate_password(password)
    except DjangoValidationError as exc:
        raise MotDePasseInvalideError(list(exc.messages)) from exc

    if User.objects.filter(email=email_normalise).exists():
        # Même coût qu'une création réelle, pour ne pas trahir le cas par le temps de réponse.
        make_password(password)
        return

    user = User.objects.create_user(email=email_normalise, phone=phone, password=password)
    Enrollment.objects.create(user=user, status=Enrollment.Status.PENDING)
    envoyer_email_bienvenue(user)


def connecter(
    *, email: str, password: str, device_fingerprint: str, ip_prefix: str
) -> SessionEmise:
    """Lève `IdentifiantsInvalidesError` avec le même message que le compte existe ou non."""
    email_normalise = email.strip().lower()
    user = User.objects.filter(email=email_normalise).first()

    if user is None:
        check_password(password, _HACHAGE_FICTIF)
        raise IdentifiantsInvalidesError

    if not user.check_password(password) or not user.is_active:
        raise IdentifiantsInvalidesError

    return _emettre_session(user, device_fingerprint, ip_prefix)


def rafraichir(*, refresh_cookie: str, device_fingerprint: str, ip_prefix: str) -> SessionEmise:
    """Ne lève `JetonInvalideError` qu'une fois la transaction validée : la révoquer sur rejeu
    (voir plus bas) doit survivre même si la suite du traitement échoue en erreur.
    """
    from django.conf import settings

    parsed = parse_refresh_cookie_value(refresh_cookie)
    if parsed is None:
        raise JetonInvalideError
    session_id, secret = parsed

    rejeu_detecte = False
    resultat: SessionEmise | None = None

    with transaction.atomic():
        session = (
            Session.objects.select_for_update().select_related("user").filter(pk=session_id).first()
        )
        valide = session is not None and session.is_valid()

        if valide:
            assert session is not None
            if not hmac.compare_digest(session.refresh_token_hash, hash_secret(secret)):
                # Rejeu d'un secret déjà tourné : toute la famille est compromise (§4.2).
                # La révocation doit être validée même si on lève ensuite : on sort du
                # bloc atomic normalement, l'exception n'est levée qu'après (voir plus bas).
                session.revoked_at = timezone.now()
                session.save(update_fields=["revoked_at"])
                rejeu_detecte = True
            else:
                nouveau_secret = generate_refresh_secret()
                session.refresh_token_hash = hash_secret(nouveau_secret)
                session.last_used_at = timezone.now()
                session.device_fingerprint = device_fingerprint[:255] or session.device_fingerprint
                session.ip_prefix = ip_prefix or session.ip_prefix
                session.save(
                    update_fields=[
                        "refresh_token_hash",
                        "last_used_at",
                        "device_fingerprint",
                        "ip_prefix",
                    ]
                )
                resultat = SessionEmise(
                    access_token=issue_access_token(session.user_id, session.id),
                    refresh_token=build_refresh_cookie_value(session.id, nouveau_secret),
                    access_ttl=settings.ACCESS_TOKEN_TTL_SECONDS,
                    refresh_ttl=settings.REFRESH_TOKEN_TTL_SECONDS,
                    user=session.user,
                )

    if not valide or rejeu_detecte or resultat is None:
        raise JetonInvalideError
    return resultat


def deconnecter(*, refresh_cookie: str | None) -> None:
    if not refresh_cookie:
        return
    parsed = parse_refresh_cookie_value(refresh_cookie)
    if parsed is None:
        return
    session_id, _secret = parsed
    Session.objects.filter(pk=session_id, revoked_at__isnull=True).update(revoked_at=timezone.now())


def deconnecter_partout(*, user: User) -> None:
    Session.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())


@transaction.atomic
def demander_reinitialisation(*, email: str) -> None:
    """N'échoue jamais et n'indique jamais si l'email existe (§4.2)."""
    user = User.objects.filter(email=email.strip().lower()).first()
    if user is None:
        return

    secret = generate_reset_secret()
    PasswordResetToken.objects.create(
        user=user, token_hash=hash_secret(secret), expires_at=reset_token_expiry()
    )
    envoyer_email_reinitialisation(user, secret)


@transaction.atomic
def confirmer_reinitialisation(*, token: str, password: str) -> None:
    try:
        validate_password(password)
    except DjangoValidationError as exc:
        raise MotDePasseInvalideError(list(exc.messages)) from exc

    token_hash = hash_secret(token)
    reset = (
        PasswordResetToken.objects.select_for_update()
        .select_related("user")
        .filter(token_hash=token_hash)
        .first()
    )
    if reset is None or not reset.is_valid():
        raise JetonInvalideError

    user = reset.user
    user.set_password(password)
    user.save(update_fields=["password"])

    reset.used_at = timezone.now()
    reset.save(update_fields=["used_at"])

    # Le mot de passe change : toutes les sessions ouvertes ailleurs sont coupées (§4.2).
    deconnecter_partout(user=user)

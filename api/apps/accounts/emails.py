"""Emails transactionnels du cycle d'authentification. Backend console en dev (§9 les étoffera)."""

from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail

from apps.accounts.models import User


def envoyer_email_bienvenue(user: User) -> None:
    send_mail(
        subject="Bienvenue sur anis.dev",
        message=(
            f"Bonjour,\n\nTon compte anis.dev est créé. Le premier chapitre est "
            f"disponible dès maintenant, sans paiement.\n\n{settings.SITE_URL}/app"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


def envoyer_email_reinitialisation(user: User, token: str) -> None:
    lien = f"{settings.SITE_URL}/nouveau-mot-de-passe?token={token}"
    send_mail(
        subject="Réinitialise ton mot de passe anis.dev",
        message=(
            f"Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien "
            f"(valable 30 minutes) :\n{lien}\n\n"
            "Si tu n'es pas à l'origine de cette demande, ignore cet email."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )

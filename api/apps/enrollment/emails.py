"""Emails du cycle d'inscription payante. Backend console en dev.

Aucun de ces messages ne contient de lien signé, de token ni de pièce jointe (§4.6) :
un email traverse des serveurs qu'on ne maîtrise pas.
"""

from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail

from apps.accounts.models import User


def _envoyer(user: User, sujet: str, corps: str) -> None:
    send_mail(
        subject=sujet,
        message=corps,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


def envoyer_email_preuve_recue(user: User) -> None:
    _envoyer(
        user,
        "Reçu bien arrivé — anis.dev",
        (
            "Bonjour,\n\nTon reçu est bien arrivé. On le vérifie sous 24 h et tu reçois "
            "un email dès que ton accès est ouvert.\n\n"
            "En attendant, le premier chapitre reste disponible :\n"
            f"{settings.SITE_URL}/app"
        ),
    )


def envoyer_email_compte_active(user: User) -> None:
    _envoyer(
        user,
        "Ton accès est ouvert — anis.dev",
        (
            "Bonjour,\n\nTon versement est validé : la formation complète est ouverte.\n\n"
            f"Reprends ici :\n{settings.SITE_URL}/app"
        ),
    )


def envoyer_email_preuve_refusee(user: User, motif: str) -> None:
    _envoyer(
        user,
        "Ton reçu n'a pas pu être validé — anis.dev",
        (
            f"Bonjour,\n\nOn n'a pas pu valider ton reçu.\n\nMotif : {motif}\n\n"
            "Tu peux en renvoyer un nouveau depuis ton espace :\n"
            f"{settings.SITE_URL}/app/activation"
        ),
    )

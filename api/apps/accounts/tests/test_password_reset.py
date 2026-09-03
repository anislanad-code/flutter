import re

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import PasswordResetToken, Session, User


def _extraire_token(corps_email: str) -> str:
    match = re.search(r"token=([\w-]+)", corps_email)
    assert match is not None
    return match.group(1)


@pytest.mark.django_db
def test_la_demande_repond_pareil_que_l_email_existe_ou_non(
    api_client: APIClient, utilisateur: User
) -> None:
    reponse_connue = api_client.post(
        "/api/auth/password-reset/request", {"email": utilisateur.email}, format="json"
    )
    reponse_inconnue = api_client.post(
        "/api/auth/password-reset/request", {"email": "personne@example.com"}, format="json"
    )

    assert reponse_connue.status_code == reponse_inconnue.status_code == 200
    assert reponse_connue.data == reponse_inconnue.data
    # Un seul email a réellement été envoyé : celui du compte qui existe.
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_le_cycle_complet_de_reinitialisation_revoque_les_sessions(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    assert Session.objects.filter(user=utilisateur, revoked_at__isnull=True).count() == 1

    api_client.post("/api/auth/password-reset/request", {"email": utilisateur.email}, format="json")
    token = _extraire_token(str(mail.outbox[0].body))

    confirmation = api_client.post(
        "/api/auth/password-reset/confirm",
        {"token": token, "password": "un-nouveau-mot-de-passe-1"},
        format="json",
    )
    assert confirmation.status_code == 204

    assert Session.objects.filter(user=utilisateur, revoked_at__isnull=True).count() == 0

    utilisateur.refresh_from_db()
    assert utilisateur.check_password("un-nouveau-mot-de-passe-1")


@pytest.mark.django_db
def test_un_jeton_de_reinitialisation_ne_fonctionne_qu_une_fois(
    api_client: APIClient, utilisateur: User
) -> None:
    api_client.post("/api/auth/password-reset/request", {"email": utilisateur.email}, format="json")
    token = _extraire_token(str(mail.outbox[0].body))

    premiere = api_client.post(
        "/api/auth/password-reset/confirm",
        {"token": token, "password": "un-nouveau-mot-de-passe-1"},
        format="json",
    )
    assert premiere.status_code == 204

    seconde = api_client.post(
        "/api/auth/password-reset/confirm",
        {"token": token, "password": "un-autre-mot-de-passe-2"},
        format="json",
    )
    assert seconde.status_code == 400


@pytest.mark.django_db
def test_trois_demandes_par_heure_puis_la_quatrieme_ne_casse_rien(
    api_client: APIClient, utilisateur: User
) -> None:
    for _ in range(3):
        assert (
            api_client.post(
                "/api/auth/password-reset/request", {"email": utilisateur.email}, format="json"
            ).status_code
            == 200
        )

    # Le seuil est dépassé mais la réponse reste identique (§4.2 : ne rien confirmer/infirmer).
    quatrieme = api_client.post(
        "/api/auth/password-reset/request", {"email": utilisateur.email}, format="json"
    )
    assert quatrieme.status_code == 200
    assert PasswordResetToken.objects.filter(user=utilisateur).count() == 3

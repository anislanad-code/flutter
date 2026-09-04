"""`CookieAccessTokenAuthentication` : le cookie ne suffit pas, la session doit tenir."""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Session, User
from apps.accounts.tokens import issue_access_token


def _connecter(api_client: APIClient, utilisateur: User, mot_de_passe: str) -> str:
    reponse = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    jeton: str = reponse.data["access_token"]
    return jeton


@pytest.mark.django_db
def test_un_cookie_illisible_renvoie_401_et_non_403(api_client: APIClient) -> None:
    """`authenticate_header` doit être déclaré, sinon DRF répond 403 (« authentifié mais
    pas autorisé ») pour un simple cookie corrompu."""
    api_client.cookies["access_token"] = "ceci-n-est-pas-un-token"

    reponse = api_client.get("/api/me")

    assert reponse.status_code == 401


@pytest.mark.django_db
def test_un_token_signe_pour_une_session_inexistante_est_rejete(api_client: APIClient) -> None:
    api_client.cookies["access_token"] = issue_access_token(1, uuid.uuid4())

    assert api_client.get("/api/me").status_code == 401


@pytest.mark.django_db
def test_une_session_expiree_est_rejetee_meme_avec_un_access_token_valide(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    access = _connecter(api_client, utilisateur, mot_de_passe)
    Session.objects.filter(user=utilisateur).update(expires_at=timezone.now() - timedelta(days=1))

    api_client.cookies["access_token"] = access

    assert api_client.get("/api/me").status_code == 401


@pytest.mark.django_db
def test_un_compte_desactive_perd_l_acces_immediatement(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    """Cas limite : la session reste valide, mais le compte est désactivé côté admin."""
    access = _connecter(api_client, utilisateur, mot_de_passe)
    User.objects.filter(pk=utilisateur.pk).update(is_active=False)

    api_client.cookies["access_token"] = access

    assert api_client.get("/api/me").status_code == 401


@pytest.mark.django_db
def test_un_appel_authentifie_met_a_jour_last_activity_at(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    assert utilisateur.last_activity_at is None

    api_client.cookies["access_token"] = _connecter(api_client, utilisateur, mot_de_passe)
    assert api_client.get("/api/me").status_code == 200

    utilisateur.refresh_from_db()
    assert utilisateur.last_activity_at is not None


@pytest.mark.django_db
def test_sans_cookie_l_authentification_ne_leve_rien_mais_la_permission_refuse(
    api_client: APIClient,
) -> None:
    """Deny by default (§4.3) : pas de cookie → `authenticate` renvoie None, DRF répond 401."""
    reponse = api_client.get("/api/me")

    assert reponse.status_code == 401
    assert "email" not in reponse.data

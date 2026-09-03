import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Session, User


@pytest.mark.django_db
def test_le_refresh_tourne_le_secret_et_renvoie_un_nouvel_access_token(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    connexion = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    ancien_refresh = connexion.data["refresh_token"]

    rafraichi = api_client.post(
        "/api/auth/refresh", {"refresh_token": ancien_refresh}, format="json"
    )

    assert rafraichi.status_code == 200
    assert rafraichi.data["refresh_token"] != ancien_refresh
    assert rafraichi.data["access_token"] != connexion.data["access_token"]


@pytest.mark.django_db
def test_un_refresh_rejoue_invalide_toute_la_famille(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    connexion = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    ancien_refresh = connexion.data["refresh_token"]

    premier = api_client.post("/api/auth/refresh", {"refresh_token": ancien_refresh}, format="json")
    assert premier.status_code == 200
    nouveau_refresh = premier.data["refresh_token"]

    # Rejeu de l'ancien secret, déjà tourné : toute la famille doit être coupée.
    rejeu = api_client.post("/api/auth/refresh", {"refresh_token": ancien_refresh}, format="json")
    assert rejeu.status_code == 401

    session_id = ancien_refresh.split(".", 1)[0]
    assert Session.objects.get(pk=session_id).revoked_at is not None

    # Le refresh pourtant valide issu de la rotation ne fonctionne plus non plus.
    apres_revocation = api_client.post(
        "/api/auth/refresh", {"refresh_token": nouveau_refresh}, format="json"
    )
    assert apres_revocation.status_code == 401


@pytest.mark.django_db
def test_un_refresh_invalide_renvoie_401(api_client: APIClient) -> None:
    reponse = api_client.post(
        "/api/auth/refresh",
        {"refresh_token": "00000000-0000-0000-0000-000000000000.rien"},
        format="json",
    )
    assert reponse.status_code == 401

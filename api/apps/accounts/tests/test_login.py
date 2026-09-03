import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User


@pytest.mark.django_db
def test_connexion_reussie_renvoie_des_tokens(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    reponse = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )

    assert reponse.status_code == 200
    assert reponse.data["access_token"]
    assert reponse.data["refresh_token"]


@pytest.mark.django_db
def test_email_inexistant_et_mauvais_mot_de_passe_donnent_la_meme_reponse(
    api_client: APIClient, utilisateur: User
) -> None:
    reponse_inconnue = api_client.post(
        "/api/auth/login",
        {"email": "personne@example.com", "password": "peu-importe-1234"},
        format="json",
    )
    reponse_mauvais_mdp = api_client.post(
        "/api/auth/login",
        {"email": utilisateur.email, "password": "mauvais-mot-de-passe-1"},
        format="json",
    )

    assert reponse_inconnue.status_code == reponse_mauvais_mdp.status_code == 401
    assert reponse_inconnue.data == reponse_mauvais_mdp.data


@pytest.mark.django_db
def test_six_echecs_en_quinze_minutes_renvoient_429(
    api_client: APIClient, utilisateur: User
) -> None:
    for _ in range(5):
        reponse = api_client.post(
            "/api/auth/login",
            {"email": utilisateur.email, "password": "mauvais-mdp"},
            format="json",
        )
        assert reponse.status_code == 401

    sixieme = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": "mauvais-mdp"}, format="json"
    )

    assert sixieme.status_code == 429


@pytest.mark.django_db
def test_get_me_authentifie_avec_le_cookie_httponly(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    connexion = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    api_client.cookies["access_token"] = connexion.data["access_token"]

    reponse = api_client.get("/api/me")

    assert reponse.status_code == 200
    assert reponse.data["email"] == utilisateur.email


@pytest.mark.django_db
def test_get_me_sans_cookie_renvoie_401(api_client: APIClient) -> None:
    assert api_client.get("/api/me").status_code == 401

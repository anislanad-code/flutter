import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User


@pytest.mark.django_db
def test_l_inscription_ignore_is_staff_et_is_active_envoyes_par_le_client(
    api_client: APIClient,
) -> None:
    reponse = api_client.post(
        "/api/auth/register",
        {
            "email": "escalade@example.com",
            "password": "un-mot-de-passe-solide-1",
            "is_staff": True,
            "is_active": False,
            "role": "admin",
        },
        format="json",
    )

    assert reponse.status_code == 201
    utilisateur = User.objects.get(email="escalade@example.com")
    assert utilisateur.is_staff is False
    assert utilisateur.is_active is True


def test_aucune_route_n_existe_pour_qu_un_tiers_definisse_un_mot_de_passe() -> None:
    """L'admin ne peut qu'envoyer un lien de reset ou révoquer des sessions (CLAUDE.md §2)."""
    from django.urls import NoReverseMatch, reverse

    for nom_interdit in ["admin-set-password", "admin-users-set-password", "set-password"]:
        with pytest.raises(NoReverseMatch):
            reverse(nom_interdit)


@pytest.mark.django_db
def test_un_access_token_signe_pour_un_autre_utilisateur_est_rejete(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    from uuid import UUID

    from apps.accounts.tokens import issue_access_token

    connexion = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    session_id = UUID(connexion.data["refresh_token"].split(".", 1)[0])

    autre = User.objects.create_user(email="autre@example.com", password="peu-importe-1234")
    # Le jeton signé porte l'id de « autre » mais l'id de session de l'étudiante : incohérent,
    # doit être rejeté (le lookup se fait par (session_id, user_id) — voir authentication.py).
    token_falsifie = issue_access_token(autre.id, session_id)

    api_client.cookies["access_token"] = token_falsifie
    assert api_client.get("/api/me").status_code == 401


@pytest.mark.django_db
def test_le_serializer_me_n_expose_pas_le_mot_de_passe(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    connexion = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    api_client.cookies["access_token"] = connexion.data["access_token"]

    reponse = api_client.get("/api/me")

    assert "password" not in reponse.data

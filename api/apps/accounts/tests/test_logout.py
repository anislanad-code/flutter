import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Session, User


@pytest.mark.django_db
def test_logout_revoque_la_session_et_le_refresh_ne_fonctionne_plus(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    connexion = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    refresh_token = connexion.data["refresh_token"]

    deconnexion = api_client.post(
        "/api/auth/logout", {"refresh_token": refresh_token}, format="json"
    )
    assert deconnexion.status_code == 204

    rafraichi = api_client.post(
        "/api/auth/refresh", {"refresh_token": refresh_token}, format="json"
    )
    assert rafraichi.status_code == 401


@pytest.mark.django_db
def test_logout_all_coupe_toutes_les_sessions_y_compris_l_acces_deja_emis(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    session_a = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    autre_client = APIClient()
    session_b = autre_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )
    assert Session.objects.filter(user=utilisateur, revoked_at__isnull=True).count() == 2

    api_client.cookies["access_token"] = session_a.data["access_token"]
    reponse = api_client.post("/api/auth/logout-all")
    assert reponse.status_code == 204

    assert Session.objects.filter(user=utilisateur, revoked_at__isnull=True).count() == 0

    # La session de « session_a » elle-même est coupée immédiatement (pas seulement au refresh).
    api_client.cookies["access_token"] = session_a.data["access_token"]
    assert api_client.get("/api/me").status_code == 401

    autre_client.cookies["access_token"] = session_b.data["access_token"]
    assert autre_client.get("/api/me").status_code == 401

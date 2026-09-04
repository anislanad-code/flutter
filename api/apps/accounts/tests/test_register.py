import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.enrollment.models import Enrollment


@pytest.mark.django_db
def test_l_inscription_cree_un_compte_et_un_enrollment_pending(api_client: APIClient) -> None:
    reponse = api_client.post(
        "/api/auth/register",
        {
            "email": "nouvelle@example.com",
            "phone": "0555111111",
            "password": "un-mot-de-passe-solide-1",
        },
        format="json",
    )

    assert reponse.status_code == 201
    utilisateur = User.objects.get(email="nouvelle@example.com")
    assert Enrollment.objects.get(user=utilisateur).status == Enrollment.Status.PENDING
    # Jamais de connexion automatique au register : une réponse qui varie selon que le
    # compte existait déjà (avec ou sans tokens) est un oracle d'énumération à elle
    # seule, même à statut identique (§4.2 — constaté ÉLEVÉ par la porte de sécurité).
    assert "access_token" not in reponse.data
    assert "user" not in reponse.data


@pytest.mark.django_db
def test_l_inscription_envoie_un_email_de_bienvenue(api_client: APIClient) -> None:
    api_client.post(
        "/api/auth/register",
        {"email": "bienvenue@example.com", "password": "un-mot-de-passe-solide-1"},
        format="json",
    )

    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["bienvenue@example.com"]


@pytest.mark.django_db
def test_l_inscription_avec_un_email_deja_pris_ne_cree_pas_de_doublon(
    api_client: APIClient, utilisateur: User
) -> None:
    nombre_avant = User.objects.count()

    reponse = api_client.post(
        "/api/auth/register",
        {"email": utilisateur.email, "password": "autre-mot-de-passe-1234"},
        format="json",
    )

    assert User.objects.count() == nombre_avant
    # Même statut que la réussite : aucune fuite sur l'existence du compte (§4.2).
    assert reponse.status_code == 201
    assert "access_token" not in reponse.data


@pytest.mark.django_db
def test_l_inscription_renvoie_une_reponse_identique_email_pris_ou_non(
    api_client: APIClient, utilisateur: User
) -> None:
    """§4.2 : pas seulement un message identique — le corps entier, à l'octet près."""
    reponse_prise = api_client.post(
        "/api/auth/register",
        {"email": utilisateur.email, "password": "un-mot-de-passe-solide-1"},
        format="json",
    )
    reponse_libre = api_client.post(
        "/api/auth/register",
        {"email": "toute-nouvelle@example.com", "password": "un-mot-de-passe-solide-1"},
        format="json",
    )

    assert reponse_prise.status_code == reponse_libre.status_code == 201
    assert reponse_prise.data == reponse_libre.data


@pytest.mark.django_db
def test_l_inscription_refuse_un_mot_de_passe_trop_court(api_client: APIClient) -> None:
    reponse = api_client.post(
        "/api/auth/register",
        {"email": "faible@example.com", "password": "court1"},
        format="json",
    )

    assert reponse.status_code == 400
    assert User.objects.filter(email="faible@example.com").exists() is False

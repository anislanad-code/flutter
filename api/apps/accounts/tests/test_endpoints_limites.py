"""Cas limites HTTP des cinq endpoints sensibles : payloads invalides, seuils, méthodes."""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Session, User

CHEMINS_PUBLICS = [
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/password-reset/request",
    "/api/auth/password-reset/confirm",
]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("chemin", "payload"),
    [
        ("/api/auth/register", {}),
        ("/api/auth/register", {"email": "pas-un-email", "password": "un-mot-de-passe-solide-1"}),
        ("/api/auth/register", {"email": "a@example.com"}),
        ("/api/auth/login", {}),
        ("/api/auth/login", {"email": "a@example.com"}),
        ("/api/auth/login", {"email": "pas-un-email", "password": "x"}),
        ("/api/auth/refresh", {}),
        ("/api/auth/refresh", {"refresh_token": ""}),
        ("/api/auth/password-reset/request", {}),
        ("/api/auth/password-reset/request", {"email": "pas-un-email"}),
        ("/api/auth/password-reset/confirm", {}),
        ("/api/auth/password-reset/confirm", {"token": "x"}),
    ],
)
def test_un_payload_invalide_renvoie_400_sans_trace(
    api_client: APIClient, chemin: str, payload: dict[str, str]
) -> None:
    reponse = api_client.post(chemin, payload, format="json")

    assert reponse.status_code == 400
    corps = str(reponse.content)
    assert "Traceback" not in corps
    assert "postgres" not in corps.lower()


@pytest.mark.django_db
def test_un_champ_de_type_inattendu_ne_provoque_pas_de_500(api_client: APIClient) -> None:
    """Cas limite : le client envoie des structures au lieu de chaînes."""
    reponse = api_client.post(
        "/api/auth/login", {"email": {"$ne": None}, "password": ["x"]}, format="json"
    )

    assert reponse.status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("chemin", CHEMINS_PUBLICS)
def test_les_endpoints_d_auth_refusent_le_get(api_client: APIClient, chemin: str) -> None:
    assert api_client.get(chemin).status_code == 405


@pytest.mark.django_db
def test_un_email_avec_espaces_et_majuscules_connecte_bien_le_bon_compte(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    reponse = api_client.post(
        "/api/auth/login",
        {"email": "  ETUDIANTE@Example.com  ", "password": mot_de_passe},
        format="json",
    )

    assert reponse.status_code == 200
    assert reponse.data["user"]["email"] == utilisateur.email


@pytest.mark.django_db
def test_l_inscription_accepte_un_telephone_absent(api_client: APIClient) -> None:
    """Cas limite : le champ est facultatif — un compte sans téléphone reste valide."""
    reponse = api_client.post(
        "/api/auth/register",
        {"email": "sans-tel@example.com", "password": "un-mot-de-passe-solide-1"},
        format="json",
    )

    assert reponse.status_code == 201
    assert User.objects.get(email="sans-tel@example.com").phone == ""


@pytest.mark.django_db
def test_l_inscription_refuse_un_mot_de_passe_courant_avec_un_message_actionnable(
    api_client: APIClient,
) -> None:
    reponse = api_client.post(
        "/api/auth/register",
        {"email": "commun@example.com", "password": "motdepasse"},
        format="json",
    )

    assert reponse.status_code == 400
    assert "password" in reponse.data
    assert reponse.data["password"]


@pytest.mark.django_db
def test_l_inscription_refuse_un_mot_de_passe_de_neuf_caracteres_et_accepte_dix(
    api_client: APIClient,
) -> None:
    """Le seuil exact du §4.2 : 10 caractères minimum."""
    neuf = api_client.post(
        "/api/auth/register", {"email": "neuf@example.com", "password": "abCdefgh1"}, format="json"
    )
    dix = api_client.post(
        "/api/auth/register", {"email": "dix@example.com", "password": "abCdefgh12"}, format="json"
    )

    assert neuf.status_code == 400
    assert dix.status_code == 201


@pytest.mark.django_db
def test_l_inscription_limite_a_vingt_par_ip_et_par_quart_d_heure(api_client: APIClient) -> None:
    for index in range(20):
        reponse = api_client.post(
            "/api/auth/register",
            {"email": f"masse{index}@example.com", "password": "un-mot-de-passe-solide-1"},
            format="json",
            HTTP_X_FORWARDED_FOR="41.100.5.7",
        )
        assert reponse.status_code == 201, index

    vingt_et_unieme = api_client.post(
        "/api/auth/register",
        {"email": "masse-de-trop@example.com", "password": "un-mot-de-passe-solide-1"},
        format="json",
        HTTP_X_FORWARDED_FOR="41.100.5.7",
    )

    assert vingt_et_unieme.status_code == 429
    assert User.objects.filter(email="masse-de-trop@example.com").exists() is False


@pytest.mark.django_db
def test_la_limite_par_ip_de_connexion_frappe_meme_avec_des_comptes_differents(
    api_client: APIClient,
) -> None:
    """20 tentatives / 15 min / IP (§4.2), indépendamment du compte visé."""
    for index in range(20):
        reponse = api_client.post(
            "/api/auth/login",
            {"email": f"cible{index}@example.com", "password": "mauvais-mot-de-passe"},
            format="json",
            HTTP_X_FORWARDED_FOR="41.100.5.7",
        )
        assert reponse.status_code == 401, index

    vingt_et_unieme = api_client.post(
        "/api/auth/login",
        {"email": "cible-de-trop@example.com", "password": "mauvais-mot-de-passe"},
        format="json",
        HTTP_X_FORWARDED_FOR="41.100.5.7",
    )

    assert vingt_et_unieme.status_code == 429


@pytest.mark.django_db
def test_le_rafraichissement_est_limite_a_trente_par_ip(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    for _ in range(30):
        reponse = api_client.post(
            "/api/auth/refresh",
            {"refresh_token": "00000000-0000-0000-0000-000000000000.rien"},
            format="json",
            HTTP_X_FORWARDED_FOR="41.100.5.7",
        )
        assert reponse.status_code == 401

    trente_et_unieme = api_client.post(
        "/api/auth/refresh",
        {"refresh_token": "00000000-0000-0000-0000-000000000000.rien"},
        format="json",
        HTTP_X_FORWARDED_FOR="41.100.5.7",
    )

    assert trente_et_unieme.status_code == 429


@pytest.mark.django_db
def test_la_confirmation_de_reinitialisation_est_limitee_a_vingt_par_ip(
    api_client: APIClient,
) -> None:
    for _ in range(20):
        reponse = api_client.post(
            "/api/auth/password-reset/confirm",
            {"token": "jeton-invente", "password": "un-nouveau-mot-de-passe-1"},
            format="json",
            HTTP_X_FORWARDED_FOR="41.100.5.7",
        )
        assert reponse.status_code == 400

    vingt_et_unieme = api_client.post(
        "/api/auth/password-reset/confirm",
        {"token": "jeton-invente", "password": "un-nouveau-mot-de-passe-1"},
        format="json",
        HTTP_X_FORWARDED_FOR="41.100.5.7",
    )

    assert vingt_et_unieme.status_code == 429


@pytest.mark.django_db
def test_la_confirmation_refuse_un_mot_de_passe_faible_avant_meme_de_lire_le_jeton(
    api_client: APIClient,
) -> None:
    reponse = api_client.post(
        "/api/auth/password-reset/confirm",
        {"token": "jeton-invente", "password": "court"},
        format="json",
    )

    assert reponse.status_code == 400
    assert "password" in reponse.data


@pytest.mark.django_db
def test_la_limite_de_connexion_par_compte_ne_bloque_pas_les_autres_comptes(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    """Cas limite : un attaquant ne doit pas pouvoir verrouiller un tiers en épuisant
    le compteur d'un autre compte."""
    autre = User.objects.create_user(email="autre@example.com", password=mot_de_passe)
    for _ in range(6):
        api_client.post(
            "/api/auth/login",
            {"email": utilisateur.email, "password": "mauvais"},
            format="json",
            HTTP_X_FORWARDED_FOR="41.100.5.7",
        )

    reponse = api_client.post(
        "/api/auth/login",
        {"email": autre.email, "password": mot_de_passe},
        format="json",
        HTTP_X_FORWARDED_FOR="41.100.6.7",
    )

    assert reponse.status_code == 200


@pytest.mark.django_db
def test_logout_sans_corps_reussit_quand_meme(api_client: APIClient) -> None:
    """Le BFF appelle toujours `logout` en best-effort, même sans cookie de refresh."""
    assert api_client.post("/api/auth/logout", {}, format="json").status_code == 204


@pytest.mark.django_db
def test_logout_all_sans_authentification_renvoie_401(api_client: APIClient) -> None:
    assert api_client.post("/api/auth/logout-all").status_code == 401


@pytest.mark.django_db
def test_logout_all_ne_coupe_que_les_sessions_de_l_appelant(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    autre = User.objects.create_user(email="autre@example.com", password=mot_de_passe)
    client_autre = APIClient()
    client_autre.post(
        "/api/auth/login", {"email": autre.email, "password": mot_de_passe}, format="json"
    )
    connexion = api_client.post(
        "/api/auth/login", {"email": utilisateur.email, "password": mot_de_passe}, format="json"
    )

    api_client.cookies["access_token"] = connexion.data["access_token"]
    assert api_client.post("/api/auth/logout-all").status_code == 204

    assert Session.objects.filter(user=autre, revoked_at__isnull=True).count() == 1


@pytest.mark.django_db
def test_le_refresh_d_une_session_appartenant_a_un_autre_compte_echoue(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    """IDOR (§4.3) : connaître l'id de session de B ne suffit pas — le secret est requis."""
    autre = User.objects.create_user(email="autre@example.com", password=mot_de_passe)
    client_autre = APIClient()
    connexion_b = client_autre.post(
        "/api/auth/login", {"email": autre.email, "password": mot_de_passe}, format="json"
    )
    session_id_de_b = connexion_b.data["refresh_token"].split(".", 1)[0]

    reponse = api_client.post(
        "/api/auth/refresh",
        {"refresh_token": f"{session_id_de_b}.secret-devine"},
        format="json",
    )

    assert reponse.status_code == 401

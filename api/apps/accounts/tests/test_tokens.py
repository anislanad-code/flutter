"""Émission et lecture des tokens (§4.2). Unités pures : aucun accès HTTP ici."""

import uuid

import pytest
from django.test import override_settings

from apps.accounts.tokens import (
    build_refresh_cookie_value,
    generate_refresh_secret,
    generate_reset_secret,
    hash_secret,
    issue_access_token,
    parse_refresh_cookie_value,
    read_access_token,
    refresh_expiry,
    reset_token_expiry,
)


def test_un_access_token_relu_rend_le_meme_couple_utilisateur_session() -> None:
    session_id = uuid.uuid4()
    token = issue_access_token(42, session_id)

    payload = read_access_token(token)

    assert payload is not None
    assert payload.user_id == 42
    assert payload.session_id == session_id


def test_deux_emissions_consecutives_ne_donnent_pas_le_meme_token() -> None:
    """Le nonce `jti` : sans lui, la signature étant déterministe, deux tokens émis dans
    la même seconde seraient identiques — un token « révoqué » resterait indiscernable."""
    session_id = uuid.uuid4()

    assert issue_access_token(1, session_id) != issue_access_token(1, session_id)


def test_un_access_token_falsifie_est_rejete() -> None:
    token = issue_access_token(1, uuid.uuid4())
    falsifie = token[:-3] + ("aaa" if not token.endswith("aaa") else "bbb")

    assert read_access_token(falsifie) is None


def test_un_access_token_vide_ou_absurde_est_rejete() -> None:
    for valeur in ["", "pas-un-token", "a.b.c", "..", "null"]:
        assert read_access_token(valeur) is None


@override_settings(ACCESS_TOKEN_TTL_SECONDS=-1)
def test_un_access_token_expire_est_rejete() -> None:
    """Cas limite : TTL dépassé — la signature reste valide, mais l'âge ne l'est plus."""
    token = issue_access_token(1, uuid.uuid4())

    assert read_access_token(token) is None


def test_un_access_token_dont_le_payload_est_incoherent_est_rejete() -> None:
    from django.core import signing

    from apps.accounts.tokens import ACCESS_TOKEN_SALT

    sans_sid = signing.dumps({"uid": 1}, salt=ACCESS_TOKEN_SALT)
    sid_invalide = signing.dumps({"uid": 1, "sid": "pas-un-uuid"}, salt=ACCESS_TOKEN_SALT)
    uid_invalide = signing.dumps(
        {"uid": "pas-un-entier", "sid": str(uuid.uuid4())}, salt=ACCESS_TOKEN_SALT
    )

    assert read_access_token(sans_sid) is None
    assert read_access_token(sid_invalide) is None
    assert read_access_token(uid_invalide) is None


def test_un_access_token_signe_avec_un_autre_sel_est_rejete() -> None:
    from django.core import signing

    token = signing.dumps({"uid": 1, "sid": str(uuid.uuid4())}, salt="un-autre-sel")

    assert read_access_token(token) is None


def test_le_cookie_de_refresh_fait_l_aller_retour() -> None:
    session_id = uuid.uuid4()
    secret = generate_refresh_secret()

    parsed = parse_refresh_cookie_value(build_refresh_cookie_value(session_id, secret))

    assert parsed == (session_id, secret)


def test_un_cookie_de_refresh_sans_point_est_rejete() -> None:
    assert parse_refresh_cookie_value("pasdepoint") is None
    assert parse_refresh_cookie_value("") is None


def test_un_cookie_de_refresh_dont_l_identifiant_n_est_pas_un_uuid_est_rejete() -> None:
    assert parse_refresh_cookie_value("pas-un-uuid.un-secret") is None
    assert parse_refresh_cookie_value(".un-secret") is None


def test_un_secret_contenant_un_point_reste_lisible_en_entier() -> None:
    """Cas limite : la découpe se fait sur le *premier* point seulement."""
    session_id = uuid.uuid4()

    parsed = parse_refresh_cookie_value(f"{session_id}.avec.des.points")

    assert parsed == (session_id, "avec.des.points")


def test_les_secrets_generes_sont_uniques_et_longs() -> None:
    secrets_refresh = {generate_refresh_secret() for _ in range(50)}
    secrets_reset = {generate_reset_secret() for _ in range(50)}

    assert len(secrets_refresh) == 50
    assert len(secrets_reset) == 50
    assert all(len(s) >= 32 for s in secrets_refresh | secrets_reset)


def test_le_hachage_est_stable_et_ne_contient_pas_le_secret() -> None:
    empreinte = hash_secret("un-secret")

    assert empreinte == hash_secret("un-secret")
    assert empreinte != hash_secret("un-secret ")
    assert len(empreinte) == 64
    assert "un-secret" not in empreinte


@pytest.mark.parametrize(
    ("calcul", "duree_attendue"),
    [(refresh_expiry, 7 * 24 * 3600), (reset_token_expiry, 30 * 60)],
)
def test_les_durees_de_vie_respectent_le_paragraphe_4_2(calcul, duree_attendue: int) -> None:  # type: ignore[no-untyped-def]
    from django.utils import timezone

    delta = (calcul() - timezone.now()).total_seconds()

    assert abs(delta - duree_attendue) < 5

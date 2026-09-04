from __future__ import annotations

import base64
import hashlib
import hmac

import pytest

from apps.media.signing import SignatureImpossibleError, ip_pour_signature, signer_url_lecture

CLE = "cle-de-test-bunny-token-auth"
HOTE = "vz-test.b-cdn.net"
VIDEO = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"


def _signer(*, expires_ts: int = 1_700_000_000, client_ip: str = "203.0.113.10") -> str:
    return signer_url_lecture(
        cdn_hostname=HOTE,
        video_id=VIDEO,
        token_key=CLE,
        expires_ts=expires_ts,
        client_ip=client_ip,
    )


def test_la_signature_est_deterministe() -> None:
    assert _signer() == _signer()


def test_une_autre_ip_produit_un_autre_jeton() -> None:
    a = _signer(client_ip="203.0.113.10")
    b = _signer(client_ip="198.51.100.20")
    assert a != b
    assert "203.0.113.10" not in a
    assert "198.51.100.20" not in b


def test_un_autre_expires_produit_un_autre_jeton() -> None:
    a = _signer(expires_ts=1_700_000_000)
    b = _signer(expires_ts=1_700_000_001)
    assert a != b
    assert "expires=1700000000" in a
    assert "expires=1700000001" in b


def test_le_jeton_est_dans_le_chemin_pour_que_les_segments_heritent() -> None:
    url = _signer()
    assert url.startswith(f"https://{HOTE}/bcdn_token=HS256-")
    assert f"/{VIDEO}/playlist.m3u8" in url
    assert "token_path=" in url


def test_le_hmac_correspond_a_l_algorithme_officiel() -> None:
    expires = "1700000000"
    ip = "203.0.113.10"
    chemin = f"/{VIDEO}/"
    donnees = f"token_path={chemin}"
    message = f"{chemin}{expires}{donnees}{ip}"
    condensat = hmac.new(CLE.encode(), message.encode(), hashlib.sha256).digest()
    jeton = "HS256-" + base64.urlsafe_b64encode(condensat).decode().rstrip("=")
    assert f"bcdn_token={jeton}" in _signer(client_ip=ip)


def test_ipv6_est_masquee_en_64() -> None:
    assert ip_pour_signature("2001:db8:85a3::8a2e:370:7334") == "2001:db8:85a3::"


def test_cle_vide_et_hote_invalide_sont_refuses() -> None:
    with pytest.raises(SignatureImpossibleError):
        signer_url_lecture(
            cdn_hostname=HOTE,
            video_id=VIDEO,
            token_key="",
            expires_ts=1_700_000_000,
            client_ip="203.0.113.10",
        )
    with pytest.raises(SignatureImpossibleError):
        signer_url_lecture(
            cdn_hostname="pas un hote/chemin",
            video_id=VIDEO,
            token_key=CLE,
            expires_ts=1_700_000_000,
            client_ip="203.0.113.10",
        )


def test_ip_vide_ou_invalide_reste_utilisable() -> None:
    assert ip_pour_signature("") == ""
    assert ip_pour_signature("pas-une-ip") == "pas-une-ip"
    assert _signer(client_ip="") != ""
    with pytest.raises(SignatureImpossibleError):
        signer_url_lecture(
            cdn_hostname=HOTE,
            video_id="../secret",
            token_key=CLE,
            expires_ts=1_700_000_000,
            client_ip="203.0.113.10",
        )


def test_un_prefixe_https_est_retire_de_l_hote() -> None:
    url = signer_url_lecture(
        cdn_hostname="https://vz-test.b-cdn.net/",
        video_id=VIDEO,
        token_key=CLE,
        expires_ts=1_700_000_000,
        client_ip="203.0.113.10",
    )
    assert url.startswith("https://vz-test.b-cdn.net/bcdn_token=")
    assert "https://https://" not in url


def test_un_hote_vide_est_refuse() -> None:
    with pytest.raises(SignatureImpossibleError):
        signer_url_lecture(
            cdn_hostname="   ",
            video_id=VIDEO,
            token_key=CLE,
            expires_ts=1_700_000_000,
            client_ip="203.0.113.10",
        )


def test_un_identifiant_avec_query_est_refuse() -> None:
    with pytest.raises(SignatureImpossibleError):
        signer_url_lecture(
            cdn_hostname=HOTE,
            video_id=f"{VIDEO}?x=1",
            token_key=CLE,
            expires_ts=1_700_000_000,
            client_ip="203.0.113.10",
        )


def test_ipv4_est_prise_telle_quelle() -> None:
    assert ip_pour_signature("203.0.113.10") == "203.0.113.10"

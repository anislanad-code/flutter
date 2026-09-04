"""Signature des URL Bunny Stream (token auth avancé, répertoire + IP).

Algorithme : HMAC-SHA256, préfixe `HS256-`, jeton dans le chemin (`bcdn_token`)
pour que les segments HLS héritent de l'authentification. Voir
https://bunny.net/docs/cdn/security/token-authentication/advanced et
BunnyWay/BunnyCDN.TokenAuthentication (python3/token.py).

Ce module est le seul endroit du code qui construit une URL de média. Les vues
et serializers n'y font jamais référence, pour que la sentinelle §4.1.1 reste
un filet réel.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import urllib.parse
from typing import Final

_MANIFEST: Final[str] = "playlist.m3u8"


class SignatureImpossibleError(Exception):
    """Clé ou identifiant manquant, ou identifiant qui n'est pas un id opaque."""


def _b64url_sans_padding(brut: bytes) -> str:
    return base64.urlsafe_b64encode(brut).decode("ascii").rstrip("=")


def ip_pour_signature(ip: str) -> str:
    """IPv4 exacte ; IPv6 masquée en /64 (Bunny ne lie jamais l'adresse complète)."""
    if not ip:
        return ""
    try:
        adresse = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if isinstance(adresse, ipaddress.IPv6Address):
        reseau = ipaddress.IPv6Network((adresse, 64), strict=False)
        return str(reseau.network_address)
    return str(adresse)


def _identifiant_opaque(video_id: str) -> str:
    if not video_id or any(caractere in video_id for caractere in "/\\?&# \t\n"):
        raise SignatureImpossibleError("identifiant vidéo invalide")
    return video_id


def _hote_cdn(cdn_hostname: str) -> str:
    hote = cdn_hostname.removeprefix("https://").removeprefix("http://").strip().strip("/")
    if not hote or "/" in hote:
        raise SignatureImpossibleError("hôte CDN invalide")
    return hote


def signer_url_lecture(
    *,
    cdn_hostname: str,
    video_id: str,
    token_key: str,
    expires_ts: int,
    client_ip: str,
) -> str:
    """URL HLS signée, liée à l'IP, valable jusqu'à `expires_ts` (unix secondes)."""
    if not token_key:
        raise SignatureImpossibleError("clé de signature absente")

    hote = _hote_cdn(cdn_hostname)
    identifiant = _identifiant_opaque(video_id)
    chemin_repertoire = f"/{identifiant}/"
    chemin_manifeste = f"/{identifiant}/{_MANIFEST}"
    ip_liee = ip_pour_signature(client_ip)
    expires = str(expires_ts)

    # `token_path` entre dans la signature (non encodé) et dans l'URL (encodé).
    params = {"token_path": chemin_repertoire}
    donnees_signature = "&".join(f"{cle}={valeur}" for cle, valeur in sorted(params.items()))
    donnees_url = "&".join(
        f"{cle}={urllib.parse.quote(valeur, safe='')}" for cle, valeur in sorted(params.items())
    )

    message = f"{chemin_repertoire}{expires}{donnees_signature}{ip_liee}"
    condensat = hmac.new(
        token_key.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    jeton = "HS256-" + _b64url_sans_padding(condensat)

    # Jeton dans le chemin : le lecteur résout les segments en relatif, ils
    # héritent donc de l'authentification sans qu'on les signe un par un.
    return f"https://{hote}/bcdn_token={jeton}&{donnees_url}&expires={expires}{chemin_manifeste}"

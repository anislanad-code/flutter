"""Extraction de l'IP réelle du visiteur.

Django n'est jamais exposé publiquement (CLAUDE.md §3) : le seul appelant est le serveur
Next, qui doit transmettre l'IP du navigateur dans `X-Forwarded-For`. On ne fait donc
confiance à cet en-tête que parce que le réseau garantit qu'aucun tiers ne peut l'atteindre
directement — ne jamais réutiliser cette fonction si Django devient un jour public.
"""

from __future__ import annotations

from rest_framework.request import Request


def get_client_ip(request: Request) -> str:
    forwarded: str = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    remote_addr: str = request.META.get("REMOTE_ADDR", "")
    return remote_addr or ""


def ip_prefix(ip: str) -> str:
    """Préfixe réseau grossier (§4.1.2) : les 3 premiers octets en IPv4, /64 en IPv6."""
    if ":" in ip:
        blocks = ip.split(":")
        return ":".join(blocks[:4])
    parts = ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3])
    return ip

"""Signature des URLs de consultation de preuve (CLAUDE.md §4.5 : TTL 10 minutes).

La signature lie **trois** choses : la preuve, l'admin qui a demandé l'URL, et l'instant
d'expiration. Lier l'admin est ce qui empêche qu'une URL recopiée depuis un journal, un
historique de navigation ou une capture d'écran serve à quelqu'un d'autre.

La signature ne remplace jamais l'authentification : la vue qui sert le fichier exige
*aussi* une session admin valide (§4.3, deny by default). Une URL signée est une
autorisation supplémentaire à durée de vie courte, pas un droit d'entrée.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from django.conf import settings

DUREE_VALIDITE_SECONDES = 600


def _signature(proof_id: str, actor_id: int, expires: int) -> str:
    message = f"{proof_id}:{actor_id}:{expires}".encode()
    cle = f"preuve-paiement:{settings.SECRET_KEY}".encode()
    return hmac.new(cle, message, hashlib.sha256).hexdigest()


def signer(*, proof_id: str, actor_id: int, maintenant: int | None = None) -> tuple[int, str]:
    """Renvoie `(expires, signature)`."""
    base = maintenant if maintenant is not None else int(time.time())
    expires = base + DUREE_VALIDITE_SECONDES
    return expires, _signature(proof_id, actor_id, expires)


def verifier(
    *, proof_id: str, actor_id: int, expires: int, signature: str, maintenant: int | None = None
) -> bool:
    """Comparaison à temps constant, puis expiration. Les deux doivent passer."""
    attendue = _signature(proof_id, actor_id, expires)
    if not hmac.compare_digest(attendue, signature):
        return False
    instant = maintenant if maintenant is not None else int(time.time())
    return expires > instant

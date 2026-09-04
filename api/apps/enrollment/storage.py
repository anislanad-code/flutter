"""Stockage privé et chiffré des preuves de paiement (CLAUDE.md §4.5).

Trois propriétés que ce module garantit, et qui sont la raison de son existence :

1. **Hors racine web.** Les objets vivent dans un répertoire que ni Django ni Next ne
   servent : il n'existe aucune route statique qui pointe dessus. Le seul chemin de
   lecture passe par `apps.enrollment.services.ouvrir_preuve`, derrière un contrôle
   d'accès admin *et* une signature à durée de vie courte.
2. **Chiffré au repos.** Une preuve CCP porte un numéro de compte : un accès en lecture
   au disque (sauvegarde égarée, volume monté par erreur) ne doit rien donner. Fernet
   (AES-128-CBC + HMAC-SHA256) via `PAYMENT_PROOF_ENCRYPTION_KEY`.
3. **Aucun nom fourni par l'utilisateur.** La clé est un UUID hexadécimal généré ici.
   `_chemin` refuse toute clé qui n'est pas exactement 32 caractères hexadécimaux — un
   `../../etc/passwd` n'atteint donc jamais `Path.joinpath`, même si un appelant futur
   oubliait de valider en amont.

Le backend local est la seule implémentation aujourd'hui. `ProofStorage` existe pour que
le passage à un bucket S3/Bunny Storage à l'étape 10 ne touche que ce fichier.
"""

from __future__ import annotations

import base64
import hashlib
import re
import uuid
from pathlib import Path
from typing import Protocol

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

_CLE_VALIDE = re.compile(r"^[0-9a-f]{32}$")


class CleInvalideError(Exception):
    """Clé de stockage qui n'est pas un UUID hexadécimal : refus avant tout accès disque."""


class PreuveIllisibleError(Exception):
    """Objet absent du stockage, ou chiffré avec une autre clé."""


class ProofStorage(Protocol):
    def nouvelle_cle(self) -> str: ...

    def ecrire(self, cle: str, contenu: bytes) -> None: ...

    def lire(self, cle: str) -> bytes: ...

    def supprimer(self, cle: str) -> None: ...


def _fernet() -> Fernet:
    """Dérive la clé Fernet du secret d'environnement.

    On accepte un secret arbitraire plutôt qu'une clé Fernet déjà formée, parce qu'un
    opérateur produit typiquement une valeur aléatoire longue (`token_urlsafe`) et non
    une clé base64 de 32 octets. La dérivation est un SHA-256 : elle ne crée pas
    d'entropie, elle en change la forme. Le secret **doit** donc être aléatoire — la
    longueur minimale ci-dessous n'est qu'un garde-fou contre la valeur d'exemple
    laissée en place, pas une mesure de robustesse.
    """
    secret: str = settings.PAYMENT_PROOF_ENCRYPTION_KEY
    if len(secret) < 32:
        raise ImproperlyConfigured(
            "PAYMENT_PROOF_ENCRYPTION_KEY doit contenir au moins 32 caractères aléatoires."
        )
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


class LocalEncryptedProofStorage:
    """Fichiers chiffrés dans un répertoire privé du serveur."""

    def __init__(self, racine: Path | None = None) -> None:
        self._racine = Path(racine or settings.PAYMENT_PROOF_STORAGE_DIR)

    def _chemin(self, cle: str) -> Path:
        if not _CLE_VALIDE.match(cle):
            raise CleInvalideError("Clé de stockage invalide.")
        return self._racine / f"{cle}.bin"

    def nouvelle_cle(self) -> str:
        return uuid.uuid4().hex

    def ecrire(self, cle: str, contenu: bytes) -> None:
        chemin = self._chemin(cle)
        chemin.parent.mkdir(parents=True, exist_ok=True)
        chemin.write_bytes(_fernet().encrypt(contenu))
        # Lisible par le seul compte qui fait tourner l'application.
        chemin.chmod(0o600)

    def lire(self, cle: str) -> bytes:
        chemin = self._chemin(cle)
        try:
            chiffre = chemin.read_bytes()
        except OSError as exc:
            raise PreuveIllisibleError("Preuve absente du stockage.") from exc
        try:
            return _fernet().decrypt(chiffre)
        except InvalidToken as exc:
            raise PreuveIllisibleError("Preuve indéchiffrable.") from exc

    def supprimer(self, cle: str) -> None:
        self._chemin(cle).unlink(missing_ok=True)


def stockage_preuves() -> ProofStorage:
    """Point d'obtention unique — remplacé en test par un répertoire temporaire."""
    return LocalEncryptedProofStorage()

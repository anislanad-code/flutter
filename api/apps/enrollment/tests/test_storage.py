"""Stockage privé chiffré (CLAUDE.md §4.5)."""

from __future__ import annotations

from pathlib import Path

import pytest
from pytest_django.fixtures import SettingsWrapper

from apps.enrollment.storage import (
    CleInvalideError,
    LocalEncryptedProofStorage,
    PreuveIllisibleError,
    stockage_preuves,
)


def test_ecrire_puis_lire_rend_le_contenu_d_origine(stockage_temporaire: Path) -> None:
    stockage = stockage_preuves()
    cle = stockage.nouvelle_cle()

    stockage.ecrire(cle, b"contenu du recu CCP")

    assert stockage.lire(cle) == b"contenu du recu CCP"


def test_le_fichier_sur_disque_ne_contient_pas_le_contenu_en_clair(
    stockage_temporaire: Path,
) -> None:
    """Une sauvegarde égarée ou un volume monté par erreur ne doit rien donner."""
    stockage = stockage_preuves()
    cle = stockage.nouvelle_cle()
    secret = "CCP 0012345678 cle 42 — LANAD Anis".encode()

    stockage.ecrire(cle, secret)

    sur_disque = (stockage_temporaire / f"{cle}.bin").read_bytes()
    assert secret not in sur_disque
    assert b"CCP" not in sur_disque


def test_la_cle_generee_est_un_uuid_hexadecimal(stockage_temporaire: Path) -> None:
    """§4.5 : jamais le nom de fichier fourni par l'utilisateur."""
    cle = stockage_preuves().nouvelle_cle()

    assert len(cle) == 32
    assert all(caractere in "0123456789abcdef" for caractere in cle)


@pytest.mark.parametrize(
    "cle_hostile",
    [
        "../../../../etc/passwd",
        "..%2f..%2fetc%2fpasswd",
        "/etc/passwd",
        "recu.jpg",
        "",
        "AAAABBBBCCCCDDDDEEEEFFFF00001111",  # majuscules : hors du motif attendu
    ],
)
def test_une_cle_hors_motif_est_refusee_avant_tout_acces_disque(
    stockage_temporaire: Path, cle_hostile: str
) -> None:
    stockage = stockage_preuves()

    with pytest.raises(CleInvalideError):
        stockage.lire(cle_hostile)
    with pytest.raises(CleInvalideError):
        stockage.ecrire(cle_hostile, b"x")


def test_lire_une_cle_inexistante_leve_plutot_que_de_renvoyer_du_vide(
    stockage_temporaire: Path,
) -> None:
    with pytest.raises(PreuveIllisibleError):
        stockage_preuves().lire("f" * 32)


def test_un_objet_chiffre_avec_une_autre_cle_est_illisible(
    stockage_temporaire: Path, settings: SettingsWrapper
) -> None:
    stockage = stockage_preuves()
    cle = stockage.nouvelle_cle()
    stockage.ecrire(cle, b"recu")

    settings.PAYMENT_PROOF_ENCRYPTION_KEY = "une-tout-autre-cle-de-chiffrement-bien-assez-longue"

    with pytest.raises(PreuveIllisibleError):
        stockage_preuves().lire(cle)


def test_supprimer_est_idempotent(stockage_temporaire: Path) -> None:
    stockage = stockage_preuves()
    cle = stockage.nouvelle_cle()
    stockage.ecrire(cle, b"recu")

    stockage.supprimer(cle)
    stockage.supprimer(cle)

    assert not (stockage_temporaire / f"{cle}.bin").exists()


def test_le_fichier_chiffre_n_est_lisible_que_par_le_proprietaire(
    stockage_temporaire: Path,
) -> None:
    stockage = stockage_preuves()
    cle = stockage.nouvelle_cle()
    stockage.ecrire(cle, b"recu")

    mode = (stockage_temporaire / f"{cle}.bin").stat().st_mode & 0o777
    assert mode == 0o600


def test_un_secret_trop_court_fait_echouer_le_chiffrement(settings: SettingsWrapper) -> None:
    """Mieux vaut refuser d'écrire que de chiffrer avec de la paille (§4.5)."""
    from django.core.exceptions import ImproperlyConfigured

    settings.PAYMENT_PROOF_ENCRYPTION_KEY = "trop-court"
    stockage = LocalEncryptedProofStorage()

    with pytest.raises(ImproperlyConfigured):
        stockage.ecrire("a" * 32, b"recu")

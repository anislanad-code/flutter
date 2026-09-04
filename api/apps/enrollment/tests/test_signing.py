"""Signature des URLs de consultation de preuve (CLAUDE.md §4.5, checklist §8 point 1)."""

from __future__ import annotations

import time

from apps.enrollment.signing import DUREE_VALIDITE_SECONDES, signer, verifier

PROOF = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
AUTRE_PROOF = "9c858901-8a57-4791-81fe-4c455b099bc9"


def test_une_signature_fraiche_est_acceptee() -> None:
    expires, signature = signer(proof_id=PROOF, actor_id=1)

    assert verifier(proof_id=PROOF, actor_id=1, expires=expires, signature=signature)


def test_la_duree_de_validite_est_de_dix_minutes() -> None:
    maintenant = int(time.time())
    expires, _ = signer(proof_id=PROOF, actor_id=1, maintenant=maintenant)

    assert expires - maintenant == DUREE_VALIDITE_SECONDES == 600


def test_une_signature_expiree_est_refusee() -> None:
    """Rejeu après expiration : le cas nommé de la checklist."""
    maintenant = int(time.time())
    expires, signature = signer(proof_id=PROOF, actor_id=1, maintenant=maintenant)

    assert not verifier(
        proof_id=PROOF,
        actor_id=1,
        expires=expires,
        signature=signature,
        maintenant=maintenant + DUREE_VALIDITE_SECONDES + 1,
    )


def test_une_signature_ne_vaut_que_pour_l_admin_qui_l_a_demandee() -> None:
    """Une URL recopiée depuis un historique ou une capture ne sert à personne d'autre."""
    expires, signature = signer(proof_id=PROOF, actor_id=1)

    assert not verifier(proof_id=PROOF, actor_id=2, expires=expires, signature=signature)


def test_une_signature_ne_vaut_que_pour_la_preuve_qu_elle_designe() -> None:
    expires, signature = signer(proof_id=PROOF, actor_id=1)

    assert not verifier(proof_id=AUTRE_PROOF, actor_id=1, expires=expires, signature=signature)


def test_repousser_l_expiration_invalide_la_signature() -> None:
    """`expires` est signé : on ne peut pas le rallonger dans l'URL."""
    expires, signature = signer(proof_id=PROOF, actor_id=1)

    assert not verifier(proof_id=PROOF, actor_id=1, expires=expires + 86_400, signature=signature)


def test_une_signature_vide_ou_bidon_est_refusee() -> None:
    expires, _ = signer(proof_id=PROOF, actor_id=1)

    assert not verifier(proof_id=PROOF, actor_id=1, expires=expires, signature="")
    assert not verifier(proof_id=PROOF, actor_id=1, expires=expires, signature="0" * 64)

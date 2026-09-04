"""Fournisseurs de paiement (CLAUDE.md §2 : ne pas coder « CCP » en dur partout).

Aujourd'hui une seule implémentation, `ManualCCPProvider` : l'étudiant verse au CCP puis
téléverse le reçu. Chargily arrivera à l'étape 11 derrière la même interface, sans que
les vues, les services ni le front aient à distinguer les deux.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from django.conf import settings


@dataclass(frozen=True)
class InstructionsPaiement:
    """Ce que le front affiche à un compte en attente. Rien de secret ici : ces
    coordonnées sont publiques par nature, c'est un compte destiné à recevoir des
    versements."""

    provider: str
    requiert_preuve: bool
    amount_dzd: int
    account_label: str
    account_number: str
    account_key: str
    account_holder: str
    reference: str


class PaymentProvider(Protocol):
    code: str

    def instructions(self, *, reference: str) -> InstructionsPaiement: ...


class ManualCCPProvider:
    """Versement CCP puis dépôt d'un reçu, validé à la main par l'admin."""

    code = "MANUAL_CCP"

    def instructions(self, *, reference: str) -> InstructionsPaiement:
        return InstructionsPaiement(
            provider=self.code,
            requiert_preuve=True,
            amount_dzd=settings.COURSE_PRICE_DZD,
            account_label="CCP",
            account_number=settings.CCP_ACCOUNT_NUMBER,
            account_key=settings.CCP_ACCOUNT_KEY,
            account_holder=settings.CCP_ACCOUNT_HOLDER,
            reference=reference,
        )


def fournisseur_actif() -> PaymentProvider:
    """Point d'obtention unique. Un seul fournisseur tant que Chargily n'existe pas."""
    return ManualCCPProvider()


def reference_versement(enrollment_id: int) -> str:
    """Référence à recopier sur le bordereau, pour que l'admin rapproche sans ambiguïté.

    Dérivée de l'identifiant d'inscription : c'est un numéro de dossier, pas un secret.
    Elle ne donne accès à rien — toutes les routes vérifient l'identité de l'appelant.
    """
    return f"ANISDEV-{enrollment_id:06d}"

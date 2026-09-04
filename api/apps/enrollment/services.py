"""Logique métier de l'inscription payante (CLAUDE.md §7 : jamais dans les vues).

Toute transition d'état — dépôt d'une preuve, validation, refus, purge — s'exécute dans
une transaction atomique et laisse une trace dans `AuditLog` quand elle vient d'un admin
(§4.6). Aucune fonction de ce module ne renvoie de contenu de fichier sans avoir vérifié
*à la fois* le statut admin de l'appelant et une signature à durée de vie courte.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.audit.services import journaliser
from apps.catalog.models import Course
from apps.enrollment import emails
from apps.enrollment.files import assainir_preuve
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.providers import (
    InstructionsPaiement,
    fournisseur_actif,
    reference_versement,
)
from apps.enrollment.signing import signer, verifier
from apps.enrollment.storage import PreuveIllisibleError, stockage_preuves

DELAI_PURGE = dt.timedelta(days=90)

CIBLE_ENROLLMENT = "Enrollment"
CIBLE_PAYMENT_PROOF = "PaymentProof"


class InscriptionIntrouvableError(Exception):
    """Aucune inscription pour ce compte, ou pas la sienne. Traduit en 404 (§4.3)."""


class DepotImpossibleError(Exception):
    """Dépôt refusé pour une raison d'état (déjà actif, reçu déjà en cours d'examen)."""


class TransitionImpossibleError(Exception):
    """Action admin sur une inscription qui n'a pas de preuve à examiner."""


class PreuveIndisponibleError(Exception):
    """Preuve purgée, signature invalide ou expirée. Traduit en 404, jamais en 403."""


# --- Inscription -----------------------------------------------------------


def creer_inscription_initiale(user: User) -> Enrollment:
    """Appelée à la création du compte. `PENDING`, rattachée à la formation publiée.

    S'il n'y a pas exactement une formation publiée, l'inscription est créée sans
    formation : le rattachement se fera au premier dépôt de reçu. On ne devine jamais
    à la place de l'utilisateur quand le catalogue en contient plusieurs (§1).
    """
    # Une inscription par compte tant qu'il n'y a qu'une formation. La contrainte
    # `(user, course)` ne suffirait pas à l'empêcher : PostgreSQL considère deux NULL
    # comme distincts, un compte inscrit avant la publication du cours pourrait donc en
    # accumuler deux. On regarde donc explicitement s'il en existe déjà une.
    existante = Enrollment.objects.filter(user=user).order_by("created_at").first()
    if existante is not None:
        return existante
    return Enrollment.objects.create(
        user=user, course=_cours_par_defaut(), status=Enrollment.Status.PENDING
    )


def _cours_par_defaut() -> Course | None:
    publies = list(Course.objects.filter(is_published=True)[:2])
    return publies[0] if len(publies) == 1 else None


def inscription_de(user: User) -> Enrollment:
    """L'inscription du compte courant. Jamais celle d'un autre : `user` vient de la session."""
    inscription = Enrollment.objects.filter(user=user).order_by("created_at").first()
    if inscription is None:
        inscription = creer_inscription_initiale(user)
    return inscription


def a_acces_au_contenu(user: User) -> bool:
    """Vrai seulement pour une inscription `ACTIVE` (§4.4).

    Utilisé par le catalogue pour décider si un chapitre payant peut être servi. Un
    compte `PENDING`, `BLOCKED` ou `EXPIRED` n'a droit qu'aux chapitres `is_free`.
    """
    return Enrollment.objects.filter(user=user, status=Enrollment.Status.ACTIVE).exists()


@dataclass(frozen=True)
class EtatInscription:
    enrollment: Enrollment
    instructions: InstructionsPaiement
    derniere_preuve: PaymentProof | None
    depot_possible: bool


def etat_inscription(user: User) -> EtatInscription:
    inscription = inscription_de(user)
    derniere = inscription.payment_proofs.order_by("-created_at").first()
    en_examen = derniere is not None and derniere.status == PaymentProof.Status.SUBMITTED
    return EtatInscription(
        enrollment=inscription,
        instructions=fournisseur_actif().instructions(
            reference=reference_versement(inscription.pk)
        ),
        derniere_preuve=derniere,
        # Un compte bloqué ou expiré n'a plus de reçu à envoyer : seul `PENDING`
        # sans preuve en cours d'examen peut déposer.
        depot_possible=inscription.status == Enrollment.Status.PENDING and not en_examen,
    )


# --- Dépôt d'une preuve ----------------------------------------------------


@transaction.atomic
def deposer_preuve(*, user: User, contenu: bytes, amount_declared: int) -> PaymentProof:
    """Assainit puis stocke le fichier, et crée la preuve en `SUBMITTED`.

    `assainir_preuve` lève `FichierRefuseError` avant tout accès disque : rien de ce que
    l'utilisateur a envoyé n'est écrit tel quel (§4.5).
    """
    inscription = (
        Enrollment.objects.select_for_update().filter(user=user).order_by("created_at").first()
    )
    if inscription is None:
        inscription = creer_inscription_initiale(user)

    if inscription.status != Enrollment.Status.PENDING:
        raise DepotImpossibleError("Ton accès n'attend plus de reçu.")

    if inscription.payment_proofs.filter(status=PaymentProof.Status.SUBMITTED).exists():
        raise DepotImpossibleError("Ton reçu est déjà en cours de vérification.")

    if inscription.course is None:
        inscription.course = _cours_par_defaut()
        inscription.save(update_fields=["course"])

    assainie = assainir_preuve(contenu)

    stockage = stockage_preuves()
    cle = stockage.nouvelle_cle()
    stockage.ecrire(cle, assainie.contenu)

    preuve = PaymentProof.objects.create(
        enrollment=inscription,
        file_key=cle,
        content_type=assainie.content_type,
        byte_size=len(assainie.contenu),
        amount_declared=amount_declared,
    )

    journaliser(
        actor=user,
        action=AuditLog.Action.PROOF_SUBMITTED,
        target_type=CIBLE_PAYMENT_PROOF,
        target_id=preuve.pk,
        metadata={"enrollment_id": inscription.pk, "amount_declared": amount_declared},
    )
    # Après le commit : un email parti pour une transaction annulée est un mensonge.
    transaction.on_commit(lambda: emails.envoyer_email_preuve_recue(user))
    return preuve


# --- Actions admin ---------------------------------------------------------


def _preuve_a_examiner(enrollment_id: int) -> tuple[Enrollment, PaymentProof]:
    inscription = (
        Enrollment.objects.select_for_update()
        .select_related("user")
        .filter(pk=enrollment_id)
        .first()
    )
    if inscription is None:
        raise InscriptionIntrouvableError
    preuve = (
        inscription.payment_proofs.select_for_update()
        .filter(status=PaymentProof.Status.SUBMITTED)
        .order_by("-created_at")
        .first()
    )
    if preuve is None:
        raise TransitionImpossibleError("Cette inscription n'a aucun reçu à examiner.")
    return inscription, preuve


@transaction.atomic
def accepter_inscription(*, admin: User, enrollment_id: int, note: str = "") -> Enrollment:
    inscription, preuve = _preuve_a_examiner(enrollment_id)
    maintenant = timezone.now()

    preuve.status = PaymentProof.Status.ACCEPTED
    preuve.reviewed_by = admin
    preuve.reviewed_at = maintenant
    preuve.purge_after = maintenant + DELAI_PURGE
    preuve.save(update_fields=["status", "reviewed_by", "reviewed_at", "purge_after"])

    inscription.status = Enrollment.Status.ACTIVE
    inscription.activated_at = maintenant
    inscription.activated_by = admin
    if note:
        inscription.note_admin = note
    inscription.save(update_fields=["status", "activated_at", "activated_by", "note_admin"])

    journaliser(
        actor=admin,
        action=AuditLog.Action.ENROLLMENT_ACCEPTED,
        target_type=CIBLE_ENROLLMENT,
        target_id=inscription.pk,
        metadata={"proof_id": str(preuve.pk), "user_id": inscription.user_id},
    )
    etudiant = inscription.user
    transaction.on_commit(lambda: emails.envoyer_email_compte_active(etudiant))
    return inscription


@transaction.atomic
def refuser_preuve(*, admin: User, enrollment_id: int, motif: str) -> Enrollment:
    motif_propre = motif.strip()
    if not motif_propre:
        raise TransitionImpossibleError("Un refus doit toujours dire pourquoi.")

    inscription, preuve = _preuve_a_examiner(enrollment_id)
    maintenant = timezone.now()

    preuve.status = PaymentProof.Status.REJECTED
    preuve.reviewed_by = admin
    preuve.reviewed_at = maintenant
    preuve.reject_reason = motif_propre
    preuve.purge_after = maintenant + DELAI_PURGE
    preuve.save(
        update_fields=["status", "reviewed_by", "reviewed_at", "reject_reason", "purge_after"]
    )

    # L'inscription reste `PENDING` : un reçu illisible n'est pas une faute, l'étudiant
    # doit pouvoir en renvoyer un autre sans intervention (§6 — dire quoi corriger).
    journaliser(
        actor=admin,
        action=AuditLog.Action.ENROLLMENT_REJECTED,
        target_type=CIBLE_ENROLLMENT,
        target_id=inscription.pk,
        metadata={"proof_id": str(preuve.pk), "user_id": inscription.user_id},
    )
    etudiant = inscription.user
    transaction.on_commit(lambda: emails.envoyer_email_preuve_refusee(etudiant, motif_propre))
    return inscription


# --- Consultation d'une preuve par l'admin ---------------------------------


@dataclass(frozen=True)
class UrlPreuveSignee:
    path: str
    expires: int
    signature: str
    expires_in: int


def emettre_url_preuve(*, admin: User, proof_id: str) -> UrlPreuveSignee:
    """Chaque émission est journalisée : c'est la consultation d'une donnée sensible (§4.5)."""
    preuve = PaymentProof.objects.filter(pk=proof_id, purged_at__isnull=True).first()
    if preuve is None:
        raise PreuveIndisponibleError

    expires, signature = signer(proof_id=str(preuve.pk), actor_id=admin.pk)
    journaliser(
        actor=admin,
        action=AuditLog.Action.PROOF_VIEWED,
        target_type=CIBLE_PAYMENT_PROOF,
        target_id=preuve.pk,
        metadata={"enrollment_id": preuve.enrollment_id},
    )
    return UrlPreuveSignee(
        # Chemin relatif, sans query string : la signature voyage en en-tête pour ne
        # jamais atterrir dans un journal d'accès (§4.6). L'hôte de Django ne doit
        # apparaître nulle part côté client (§3).
        path=f"/api/admin/proofs/{preuve.pk}/file",
        expires=expires,
        signature=signature,
        expires_in=expires - int(timezone.now().timestamp()),
    )


@dataclass(frozen=True)
class ContenuPreuve:
    contenu: bytes
    content_type: str


def ouvrir_preuve(*, admin: User, proof_id: str, expires: int, signature: str) -> ContenuPreuve:
    """Vérifie la signature *et* l'appartenance à l'admin qui l'a demandée, puis déchiffre."""
    if not verifier(
        proof_id=str(proof_id), actor_id=admin.pk, expires=expires, signature=signature
    ):
        raise PreuveIndisponibleError

    preuve = PaymentProof.objects.filter(pk=proof_id, purged_at__isnull=True).first()
    if preuve is None:
        raise PreuveIndisponibleError

    try:
        contenu = stockage_preuves().lire(preuve.file_key)
    except PreuveIllisibleError as exc:
        raise PreuveIndisponibleError from exc

    return ContenuPreuve(contenu=contenu, content_type=preuve.content_type)


# --- Purge planifiée -------------------------------------------------------


def purger_preuves_echues(*, maintenant: dt.datetime | None = None) -> int:
    """Détruit le fichier des preuves examinées depuis plus de 90 jours (§4.5).

    La ligne survit à la purge (elle porte la trace de ce qui a été validé, par qui et
    quand) ; seul le fichier — qui contient un numéro de CCP — disparaît.
    """
    instant = maintenant or timezone.now()
    stockage = stockage_preuves()
    purgees = 0

    for preuve in PaymentProof.objects.filter(
        purge_after__lte=instant, purged_at__isnull=True
    ).iterator():
        stockage.supprimer(preuve.file_key)
        preuve.purged_at = instant
        preuve.save(update_fields=["purged_at"])
        journaliser(
            actor=None,
            action=AuditLog.Action.PROOF_PURGED,
            target_type=CIBLE_PAYMENT_PROOF,
            target_id=preuve.pk,
            metadata={"enrollment_id": preuve.enrollment_id},
        )
        purgees += 1

    return purgees

"""Transitions d'état de l'inscription (CLAUDE.md §7 : services, pas les vues).

Chaque transition : succès, échec propre, idempotence, atomicité.
"""

from __future__ import annotations

from typing import cast

import pytest
from django.core import mail

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.catalog.models import Course
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.services import (
    InscriptionIntrouvableError,
    PreuveIndisponibleError,
    TransitionImpossibleError,
    a_acces_au_contenu,
    accepter_inscription,
    creer_inscription_initiale,
    deposer_preuve,
    emettre_url_preuve,
    etat_inscription,
    inscription_de,
    ouvrir_preuve,
    refuser_preuve,
)
from apps.enrollment.storage import stockage_preuves
from apps.enrollment.tests.conftest import image_octets

pytestmark = pytest.mark.django_db


def _deposer(etudiante: User) -> PaymentProof:
    return deposer_preuve(user=etudiante, contenu=image_octets(), amount_declared=12000)


# --- Inscription initiale --------------------------------------------------


def test_creer_inscription_initiale_est_idempotente(
    etudiante: User, inscription: Enrollment
) -> None:
    """Un second appel rend la même ligne : PostgreSQL traite deux NULL comme distincts."""
    seconde = creer_inscription_initiale(etudiante)

    assert seconde.pk == inscription.pk
    assert Enrollment.objects.filter(user=etudiante).count() == 1


def test_sans_formation_publiee_l_inscription_n_a_pas_de_cours(etudiante: User) -> None:
    inscription = creer_inscription_initiale(etudiante)

    assert inscription.course is None
    assert inscription.status == Enrollment.Status.PENDING


def test_deux_formations_publiees_ne_devinent_pas_le_cours(etudiante: User, cours: Course) -> None:
    Course.objects.create(
        slug="autre-formation",
        title="Une autre formation",
        description="Plus tard.",
        is_published=True,
    )

    inscription = creer_inscription_initiale(etudiante)

    assert inscription.course is None


def test_une_formation_non_publiee_n_est_pas_rattachee(etudiante: User, cours: Course) -> None:
    cours.is_published = False
    cours.save(update_fields=["is_published"])

    inscription = creer_inscription_initiale(etudiante)

    assert inscription.course is None


def test_inscription_de_cree_la_ligne_si_elle_manque(etudiant_b: User, cours: Course) -> None:
    assert not Enrollment.objects.filter(user=etudiant_b).exists()

    inscription = inscription_de(etudiant_b)

    assert inscription.user_id == etudiant_b.pk
    assert inscription.course_id == cours.pk
    assert Enrollment.objects.filter(user=etudiant_b).count() == 1


def test_a_acces_au_contenu_est_faux_sans_inscription(etudiant_b: User, cours: Course) -> None:
    assert a_acces_au_contenu(etudiant_b, cours) is False


def test_a_acces_au_contenu_est_faux_sur_une_autre_formation(
    etudiante: User, cours: Course
) -> None:
    """§8 relecture étape 5, ÉLEVÉ E1 : une inscription active sur une formation ne
    donne accès à aucune autre — `a_acces_au_contenu` prend la formation en argument,
    pas seulement le compte."""
    Enrollment.objects.create(user=etudiante, course=cours, status=Enrollment.Status.ACTIVE)
    autre_formation = Course.objects.create(
        slug="react-native-avance",
        title="React Native avancé",
        description="Une deuxième formation.",
        is_published=True,
    )

    assert a_acces_au_contenu(etudiante, cours) is True
    assert a_acces_au_contenu(etudiante, autre_formation) is False


def test_etat_inscription_sans_cours_expose_quand_meme_les_instructions(
    etudiante: User,
) -> None:
    Enrollment.objects.create(user=etudiante, course=None, status=Enrollment.Status.PENDING)

    etat = etat_inscription(etudiante)

    assert etat.enrollment.course is None
    assert etat.depot_possible is True
    assert etat.instructions.reference.startswith("ANISDEV-")


# --- Dépôt -----------------------------------------------------------------


def test_deposer_cree_l_inscription_si_elle_n_existe_pas(etudiant_b: User, cours: Course) -> None:
    preuve = deposer_preuve(user=etudiant_b, contenu=image_octets(), amount_declared=12000)

    inscription = Enrollment.objects.get(user=etudiant_b)
    assert inscription.course_id == cours.pk
    assert preuve.enrollment_id == inscription.pk


def test_deposer_rattache_le_cours_quand_il_etait_absent(etudiante: User, cours: Course) -> None:
    Enrollment.objects.create(user=etudiante, course=None, status=Enrollment.Status.PENDING)

    deposer_preuve(user=etudiante, contenu=image_octets(), amount_declared=12000)

    inscription = Enrollment.objects.get(user=etudiante)
    assert inscription.course_id == cours.pk


def test_deposer_ne_devine_pas_le_cours_s_il_y_en_a_plusieurs(
    etudiante: User, cours: Course
) -> None:
    Enrollment.objects.create(user=etudiante, course=None, status=Enrollment.Status.PENDING)
    Course.objects.create(
        slug="autre-formation",
        title="Une autre formation",
        description="Plus tard.",
        is_published=True,
    )

    deposer_preuve(user=etudiante, contenu=image_octets(), amount_declared=12000)

    assert Enrollment.objects.get(user=etudiante).course is None


def test_un_echec_du_journal_annule_le_depot(
    etudiante: User, cours: Course, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(**_kwargs: object) -> None:
        raise RuntimeError("audit down")

    monkeypatch.setattr("apps.enrollment.services.journaliser", _boom)

    with pytest.raises(RuntimeError, match="audit down"):
        deposer_preuve(user=etudiante, contenu=image_octets(), amount_declared=12000)

    assert PaymentProof.objects.count() == 0
    assert AuditLog.objects.count() == 0


# --- Acceptation / refus ---------------------------------------------------


def test_accepter_avec_note_la_conserve(
    etudiante: User, cours: Course, administratrice: User
) -> None:
    preuve = _deposer(etudiante)

    inscription = accepter_inscription(
        admin=administratrice, enrollment_id=preuve.enrollment_id, note="Reçu CCP lisible."
    )

    assert inscription.note_admin == "Reçu CCP lisible."
    assert inscription.status == Enrollment.Status.ACTIVE


def test_accepter_sans_note_ne_ecrase_pas_une_note_existante(
    etudiante: User, cours: Course, administratrice: User
) -> None:
    preuve = _deposer(etudiante)
    Enrollment.objects.filter(pk=preuve.enrollment_id).update(note_admin="déjà là")

    inscription = accepter_inscription(
        admin=administratrice, enrollment_id=preuve.enrollment_id, note=""
    )

    assert inscription.note_admin == "déjà là"


def test_accepter_une_inscription_inexistante_leve() -> None:
    admin = cast(
        User,
        User.objects.create_user(email="ops@example.com", password="mot-de-passe-admin-000"),
    )
    admin.is_staff = True
    admin.save(update_fields=["is_staff"])

    with pytest.raises(InscriptionIntrouvableError):
        accepter_inscription(admin=admin, enrollment_id=999_999)


def test_refuser_un_motif_vide_leve_avant_toute_ecriture(
    etudiante: User, cours: Course, administratrice: User
) -> None:
    preuve = _deposer(etudiante)

    with pytest.raises(TransitionImpossibleError, match="pourquoi"):
        refuser_preuve(admin=administratrice, enrollment_id=preuve.enrollment_id, motif="   ")

    preuve.refresh_from_db()
    assert preuve.status == PaymentProof.Status.SUBMITTED


def test_refuser_sans_preuve_en_examen_leve(inscription: Enrollment, administratrice: User) -> None:
    with pytest.raises(TransitionImpossibleError, match="aucun reçu"):
        refuser_preuve(admin=administratrice, enrollment_id=inscription.pk, motif="Illisible.")


def test_un_echec_du_journal_annule_la_validation(
    etudiante: User,
    cours: Course,
    administratrice: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preuve = _deposer(etudiante)

    def _boom(**_kwargs: object) -> None:
        raise RuntimeError("audit down")

    monkeypatch.setattr("apps.enrollment.services.journaliser", _boom)

    with pytest.raises(RuntimeError, match="audit down"):
        accepter_inscription(admin=administratrice, enrollment_id=preuve.enrollment_id)

    preuve.refresh_from_db()
    inscription = Enrollment.objects.get(pk=preuve.enrollment_id)
    assert preuve.status == PaymentProof.Status.SUBMITTED
    assert inscription.status == Enrollment.Status.PENDING
    assert inscription.activated_at is None


def test_les_emails_ne_partent_pas_pendant_la_transaction(
    etudiante: User,
    cours: Course,
    administratrice: User,
) -> None:
    """`on_commit` : sans `capture_on_commit_callbacks(execute=True)`, l'outbox reste vide."""
    preuve = _deposer(etudiante)
    mail.outbox.clear()

    accepter_inscription(admin=administratrice, enrollment_id=preuve.enrollment_id)

    assert len(mail.outbox) == 0
    assert Enrollment.objects.get(pk=preuve.enrollment_id).status == Enrollment.Status.ACTIVE


# --- Consultation ----------------------------------------------------------


def test_ouvrir_une_preuve_dont_le_fichier_a_disparu_leve(
    etudiante: User, cours: Course, administratrice: User
) -> None:
    preuve = _deposer(etudiante)
    emise = emettre_url_preuve(admin=administratrice, proof_id=str(preuve.pk))
    stockage_preuves().supprimer(preuve.file_key)

    assert "?" not in emise.path
    assert emise.signature

    with pytest.raises(PreuveIndisponibleError):
        ouvrir_preuve(
            admin=administratrice,
            proof_id=str(preuve.pk),
            expires=emise.expires,
            signature=emise.signature,
        )


def test_emettre_une_url_pour_une_preuve_inconnue_leve(administratrice: User) -> None:
    with pytest.raises(PreuveIndisponibleError):
        emettre_url_preuve(admin=administratrice, proof_id="3f2504e0-4f89-11d3-9a0c-0305e82c3301")


def test_ouvrir_avec_une_signature_invalide_leve(
    etudiante: User, cours: Course, administratrice: User
) -> None:
    preuve = _deposer(etudiante)

    with pytest.raises(PreuveIndisponibleError):
        ouvrir_preuve(
            admin=administratrice,
            proof_id=str(preuve.pk),
            expires=9_999_999_999,
            signature="0" * 64,
        )

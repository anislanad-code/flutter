"""Routes étudiant : état de l'inscription et dépôt du reçu."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.catalog.models import Course
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.tests.conftest import SVG_MALVEILLANT, image_octets, png_octets

pytestmark = pytest.mark.django_db


def _fichier(contenu: bytes, nom: str = "recu.jpg", type_declare: str = "image/jpeg"):  # type: ignore[no-untyped-def]
    return SimpleUploadedFile(nom, contenu, content_type=type_declare)


def _deposer(client: APIClient, contenu: bytes, **kwargs: object):  # type: ignore[no-untyped-def]
    charge: dict[str, object] = {"file": _fichier(contenu), "amount_declared": 12000}
    charge.update(kwargs)
    return client.post("/api/enrollment/proof", charge, format="multipart")


# --- GET /api/enrollment/status --------------------------------------------


def test_le_statut_exige_une_session(api_client: APIClient) -> None:
    assert api_client.get("/api/enrollment/status").status_code == 401


def test_le_statut_donne_les_instructions_de_versement(
    client_etudiante: APIClient, cours: Course, etudiante: User
) -> None:
    reponse = client_etudiante.get("/api/enrollment/status")

    assert reponse.status_code == 200
    assert reponse.data["status"] == "PENDING"
    assert reponse.data["depot_possible"] is True
    assert reponse.data["derniere_preuve"] is None
    assert reponse.data["instructions"]["provider"] == "MANUAL_CCP"
    assert reponse.data["instructions"]["reference"].startswith("ANISDEV-")


def test_le_statut_ne_fuit_jamais_la_cle_de_stockage(
    client_etudiante: APIClient, cours: Course
) -> None:
    """`file_key` désigne l'objet chiffré : il n'a rien à faire dans un navigateur (§4.5)."""
    _deposer(client_etudiante, image_octets())

    reponse = client_etudiante.get("/api/enrollment/status")

    assert "file_key" not in str(reponse.data)
    assert "file_key" not in reponse.data["derniere_preuve"]


# --- POST /api/enrollment/proof --------------------------------------------


def test_le_depot_exige_une_session(api_client: APIClient) -> None:
    assert _deposer(api_client, image_octets()).status_code == 401


def test_un_depot_valide_cree_la_preuve_et_previent_l_etudiante(
    client_etudiante: APIClient,
    cours: Course,
    etudiante: User,
    django_capture_on_commit_callbacks: Callable[..., AbstractContextManager[list[object]]],
) -> None:
    mail.outbox.clear()

    # L'email part dans un `on_commit` : sans ce contexte, la transaction de test est
    # annulée et le callback ne s'exécute jamais. C'est justement ce qu'on veut
    # vérifier — pas d'email envoyé pour une transaction qui n'aboutit pas.
    with django_capture_on_commit_callbacks(execute=True):
        reponse = _deposer(client_etudiante, image_octets())

    assert reponse.status_code == 201
    preuve = PaymentProof.objects.get()
    assert preuve.status == PaymentProof.Status.SUBMITTED
    assert preuve.enrollment.user_id == etudiante.pk
    assert preuve.enrollment.status == Enrollment.Status.PENDING
    assert len(mail.outbox) == 1
    assert etudiante.email in mail.outbox[0].to


def test_le_depot_est_journalise(client_etudiante: APIClient, cours: Course) -> None:
    _deposer(client_etudiante, image_octets())

    assert AuditLog.objects.filter(action=AuditLog.Action.PROOF_SUBMITTED).count() == 1


def test_le_fichier_stocke_est_le_fichier_reencode_pas_l_original(
    client_etudiante: APIClient, cours: Course
) -> None:
    charge = b"<?php system($_GET['c']); ?>"
    _deposer(client_etudiante, image_octets() + charge)

    from apps.enrollment.storage import stockage_preuves

    preuve = PaymentProof.objects.get()
    assert charge not in stockage_preuves().lire(preuve.file_key)


def test_un_png_est_accepte(client_etudiante: APIClient, cours: Course) -> None:
    assert _deposer(client_etudiante, png_octets()).status_code == 201


def test_un_svg_est_refuse_meme_deguise_en_jpg(client_etudiante: APIClient, cours: Course) -> None:
    reponse = client_etudiante.post(
        "/api/enrollment/proof",
        {"file": _fichier(SVG_MALVEILLANT, "recu.jpg", "image/jpeg"), "amount_declared": 12000},
        format="multipart",
    )

    assert reponse.status_code == 400
    assert not PaymentProof.objects.exists()


def test_un_php_renomme_en_jpg_est_refuse(client_etudiante: APIClient, cours: Course) -> None:
    reponse = _deposer(client_etudiante, b"<?php system($_GET['c']); ?>" + b"\x00" * 64)

    assert reponse.status_code == 400
    assert not PaymentProof.objects.exists()


def test_un_fichier_trop_gros_est_refuse_en_413(client_etudiante: APIClient, cours: Course) -> None:
    reponse = _deposer(client_etudiante, b"\xff\xd8\xff\xe0" + b"\x00" * (6 * 1024 * 1024))

    assert reponse.status_code == 413
    assert not PaymentProof.objects.exists()


def test_un_content_length_enorme_est_coupe_avant_l_authentification(
    api_client: APIClient,
) -> None:
    """Le middleware refuse avant parsing multipart et avant la session (§4.5)."""
    reponse = api_client.generic(
        "POST",
        "/api/enrollment/proof",
        data="x",
        content_type="multipart/form-data; boundary=xx",
        CONTENT_LENGTH=str(100 * 1024 * 1024),
    )

    assert reponse.status_code == 413
    assert reponse.json()["detail"] == "Le fichier dépasse 5 Mo."


def test_un_fichier_juste_au_dessus_de_cinq_mo_est_refuse_par_le_serializer(
    client_etudiante: APIClient, cours: Course
) -> None:
    """Entre 5 Mo et 5 Mo + enveloppe : le `CONTENT_LENGTH` passe, `file.size` non."""
    from apps.enrollment.files import TAILLE_MAX_OCTETS

    trop = b"\xff\xd8\xff\xe0" + b"\x00" * (TAILLE_MAX_OCTETS + 1024)
    reponse = _deposer(client_etudiante, trop)

    assert reponse.status_code == 400
    assert not PaymentProof.objects.exists()


def test_un_depassement_detecte_apres_lecture_renvoie_413(
    client_etudiante: APIClient, cours: Course, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Le garde-fou de `files.py` peut encore lever après que l'en-tête a menti."""
    from apps.enrollment.files import FichierTropVolumineuxError

    def _boom(**_kwargs: object) -> None:
        raise FichierTropVolumineuxError("Le fichier dépasse 5 Mo. Envoie une capture plus légère.")

    monkeypatch.setattr("apps.enrollment.services.deposer_preuve", _boom)

    reponse = _deposer(client_etudiante, image_octets())

    assert reponse.status_code == 413


def test_le_nom_de_fichier_fourni_n_est_jamais_repris(
    client_etudiante: APIClient, cours: Course
) -> None:
    """§4.5 : nom généré (UUID), jamais celui de l'utilisateur — traversée comprise."""
    client_etudiante.post(
        "/api/enrollment/proof",
        {"file": _fichier(image_octets(), "../../etc/passwd.jpg"), "amount_declared": 12000},
        format="multipart",
    )

    preuve = PaymentProof.objects.get()
    assert ".." not in preuve.file_key
    assert "/" not in preuve.file_key
    assert len(preuve.file_key) == 32


def test_un_montant_absent_ou_absurde_est_refuse(
    client_etudiante: APIClient, cours: Course
) -> None:
    sans = client_etudiante.post(
        "/api/enrollment/proof", {"file": _fichier(image_octets())}, format="multipart"
    )
    negatif = _deposer(client_etudiante, image_octets(), amount_declared=-5)
    zero = _deposer(client_etudiante, image_octets(), amount_declared=0)
    enorme = _deposer(client_etudiante, image_octets(), amount_declared=1_000_001)

    assert sans.status_code == 400
    assert negatif.status_code == 400
    assert zero.status_code == 400
    assert enorme.status_code == 400


def test_un_content_length_invalide_est_refuse_en_400(
    client_etudiante: APIClient, cours: Course
) -> None:
    """Sans ce garde-fou, `int(CONTENT_LENGTH)` lèverait 500 sur un en-tête hostile."""
    reponse = client_etudiante.post(
        "/api/enrollment/proof",
        {"file": _fichier(image_octets()), "amount_declared": 12000},
        format="multipart",
        CONTENT_LENGTH="pas-un-nombre",
    )

    assert reponse.status_code == 400
    assert reponse.data["detail"] == "Requête invalide."
    assert not PaymentProof.objects.exists()


def test_un_pdf_ordinaire_est_accepte_par_l_endpoint(
    client_etudiante: APIClient, cours: Course
) -> None:
    from apps.enrollment.tests.conftest import pdf_octets

    reponse = _deposer(client_etudiante, pdf_octets())

    assert reponse.status_code == 201
    assert PaymentProof.objects.get().content_type == "application/pdf"


def test_les_methodes_hors_contrat_sont_refusees(client_etudiante: APIClient) -> None:
    assert client_etudiante.post("/api/enrollment/status", {}).status_code == 405
    assert client_etudiante.get("/api/enrollment/proof").status_code == 405


def test_le_statut_cree_l_inscription_si_elle_manque(
    client_etudiante: APIClient, etudiante: User, cours: Course
) -> None:
    """`inscription_de` ne laisse jamais un compte connecté sans dossier."""
    assert not Enrollment.objects.filter(user=etudiante).exists()

    reponse = client_etudiante.get("/api/enrollment/status")

    assert reponse.status_code == 200
    assert Enrollment.objects.filter(user=etudiante, status=Enrollment.Status.PENDING).exists()
    assert reponse.data["course_slug"] == cours.slug


def test_le_statut_sans_cours_a_un_slug_nul(client_etudiante: APIClient, etudiante: User) -> None:
    Enrollment.objects.create(user=etudiante, course=None, status=Enrollment.Status.PENDING)

    reponse = client_etudiante.get("/api/enrollment/status")

    assert reponse.status_code == 200
    assert reponse.data["course_slug"] is None


def test_un_second_depot_est_refuse_tant_que_le_premier_est_en_examen(
    client_etudiante: APIClient, cours: Course
) -> None:
    assert _deposer(client_etudiante, image_octets()).status_code == 201

    reponse = _deposer(client_etudiante, image_octets())

    assert reponse.status_code == 409
    assert PaymentProof.objects.count() == 1


def test_un_compte_deja_actif_ne_peut_plus_deposer(
    client_etudiante: APIClient, inscription: Enrollment, etudiante: User
) -> None:
    Enrollment.objects.filter(pk=inscription.pk).update(status=Enrollment.Status.ACTIVE)

    reponse = _deposer(client_etudiante, image_octets())

    assert reponse.status_code == 409


@pytest.mark.parametrize("statut", [Enrollment.Status.BLOCKED, Enrollment.Status.EXPIRED])
def test_un_compte_bloque_ou_expire_ne_peut_plus_deposer(
    client_etudiante: APIClient, inscription: Enrollment, statut: str
) -> None:
    Enrollment.objects.filter(pk=inscription.pk).update(status=statut)

    reponse = _deposer(client_etudiante, image_octets())
    etat = client_etudiante.get("/api/enrollment/status")

    assert reponse.status_code == 409
    assert etat.data["depot_possible"] is False


def test_le_client_ne_peut_pas_se_declarer_actif_en_glissant_des_champs(
    client_etudiante: APIClient, cours: Course, etudiante: User
) -> None:
    """Checklist §8 point 3 : escalade par payload."""
    reponse = client_etudiante.post(
        "/api/enrollment/proof",
        {
            "file": _fichier(image_octets()),
            "amount_declared": 12000,
            "status": "ACCEPTED",
            "enrollment_status": "ACTIVE",
            "is_staff": True,
            "reviewed_by": 1,
            "purge_after": "2099-01-01T00:00:00Z",
        },
        format="multipart",
    )

    assert reponse.status_code == 201
    etudiante.refresh_from_db()
    preuve = PaymentProof.objects.get()
    assert etudiante.is_staff is False
    assert preuve.status == PaymentProof.Status.SUBMITTED
    assert preuve.reviewed_by is None
    assert preuve.purge_after is None
    assert Enrollment.objects.get(user=etudiante).status == Enrollment.Status.PENDING


def test_le_depot_est_limite_en_debit(client_etudiante: APIClient, cours: Course) -> None:
    codes = []
    for _ in range(12):
        # Chaque dépôt réussi bloque le suivant en 409 : on nettoie pour n'observer
        # que la limite de débit, pas la règle d'unicité.
        PaymentProof.objects.all().delete()
        codes.append(_deposer(client_etudiante, image_octets()).status_code)

    assert 429 in codes

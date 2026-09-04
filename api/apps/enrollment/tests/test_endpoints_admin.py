"""Routes d'administration : validation, refus, consultation de preuve.

Checklist §8, points 1 (IDOR), 3 (escalade de privilèges) et 7 (accès au fichier).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from typing import Any, cast

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.catalog.models import Course
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.tests.conftest import connecter, image_octets

pytestmark = pytest.mark.django_db

CaptureOnCommit = Callable[..., AbstractContextManager[list[object]]]


@pytest.fixture
def preuve_deposee(client_etudiante: APIClient, cours: Course) -> PaymentProof:
    reponse = client_etudiante.post(
        "/api/enrollment/proof",
        {
            "file": SimpleUploadedFile("recu.jpg", image_octets(), content_type="image/jpeg"),
            "amount_declared": 12000,
        },
        format="multipart",
    )
    assert reponse.status_code == 201
    return PaymentProof.objects.get()


# --- Cloisonnement ---------------------------------------------------------


@pytest.mark.parametrize(
    "chemin",
    [
        "/api/admin/enrollments",
        "/api/admin/proofs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/url",
        "/api/admin/proofs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/file",
    ],
)
def test_un_visiteur_anonyme_recoit_401(api_client: APIClient, chemin: str) -> None:
    assert api_client.get(chemin).status_code == 401


@pytest.mark.parametrize(
    "chemin",
    [
        "/api/admin/enrollments",
        "/api/admin/proofs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/url",
        "/api/admin/proofs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/file",
    ],
)
def test_un_etudiant_recoit_404_et_non_403(client_etudiante: APIClient, chemin: str) -> None:
    """§4.3 : ne jamais confirmer à un curieux qu'une route d'administration existe."""
    assert client_etudiante.get(chemin).status_code == 404


def test_un_etudiant_ne_peut_pas_valider_sa_propre_inscription(
    client_etudiante: APIClient, preuve_deposee: PaymentProof
) -> None:
    inscription_id = preuve_deposee.enrollment_id

    reponse = client_etudiante.post(f"/api/admin/enrollments/{inscription_id}/accept", {})

    assert reponse.status_code == 404
    assert Enrollment.objects.get(pk=inscription_id).status == Enrollment.Status.PENDING


def test_un_etudiant_ne_peut_pas_lire_la_preuve_d_un_autre(
    api_client: APIClient, etudiant_b: User, preuve_deposee: PaymentProof
) -> None:
    """Checklist point 1, IDOR sur la ressource la plus sensible de l'étape."""
    client_b = connecter(api_client, etudiant_b)

    assert client_b.get(f"/api/admin/proofs/{preuve_deposee.pk}/url").status_code == 404
    assert client_b.get(f"/api/admin/proofs/{preuve_deposee.pk}/file").status_code == 404
    assert client_b.get("/api/enrollment/status").data["derniere_preuve"] is None


def test_un_compte_ne_devient_pas_admin_en_le_demandant(
    client_etudiante: APIClient, etudiante: User
) -> None:
    """Checklist point 3. `is_staff` est lu en base, jamais dans un payload (§4.3)."""
    client_etudiante.post("/api/enrollment/status", {"is_staff": True}, format="json")
    etudiante.refresh_from_db()

    assert etudiante.is_staff is False
    assert client_etudiante.get("/api/admin/enrollments").status_code == 404


# --- File d'attente --------------------------------------------------------


def test_l_admin_voit_la_file(client_admin: APIClient, preuve_deposee: PaymentProof) -> None:
    reponse = client_admin.get("/api/admin/enrollments")

    assert reponse.status_code == 200
    assert len(reponse.data) == 1
    assert reponse.data[0]["user_email"] == "etudiante@example.com"
    assert reponse.data[0]["preuves"][0]["status"] == "SUBMITTED"


def test_la_file_ne_contient_jamais_la_cle_de_stockage(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    reponse = client_admin.get("/api/admin/enrollments")

    assert preuve_deposee.file_key not in str(reponse.data)
    assert "file_key" not in str(reponse.data)


def test_le_filtre_de_statut_n_accepte_que_les_valeurs_connues(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    """Checklist point 8 : ce paramètre finit dans un `filter()`."""
    assert client_admin.get("/api/admin/enrollments?status=PENDING").status_code == 200
    assert client_admin.get("/api/admin/enrollments?status=ACTIVE").data == []

    for hostile in ["' OR 1=1 --", "PENDING' UNION SELECT", "user__password", "../"]:
        reponse = client_admin.get(f"/api/admin/enrollments?status={hostile}")
        assert reponse.status_code == 400


# --- Validation ------------------------------------------------------------


def test_valider_ouvre_l_acces_journalise_et_previent(
    client_admin: APIClient,
    preuve_deposee: PaymentProof,
    administratrice: User,
    django_capture_on_commit_callbacks: CaptureOnCommit,
) -> None:
    mail.outbox.clear()
    inscription_id = preuve_deposee.enrollment_id

    with django_capture_on_commit_callbacks(execute=True):
        reponse = client_admin.post(f"/api/admin/enrollments/{inscription_id}/accept", {})

    assert reponse.status_code == 200
    inscription = Enrollment.objects.get(pk=inscription_id)
    preuve_deposee.refresh_from_db()

    assert inscription.status == Enrollment.Status.ACTIVE
    assert inscription.activated_by_id == administratrice.pk
    assert inscription.activated_at is not None
    assert preuve_deposee.status == PaymentProof.Status.ACCEPTED
    assert preuve_deposee.purge_after is not None
    assert AuditLog.objects.filter(action=AuditLog.Action.ENROLLMENT_ACCEPTED).count() == 1
    assert len(mail.outbox) == 1


def test_refuser_exige_un_motif(client_admin: APIClient, preuve_deposee: PaymentProof) -> None:
    inscription_id = preuve_deposee.enrollment_id

    vide = client_admin.post(f"/api/admin/enrollments/{inscription_id}/reject", {"reason": ""})
    absent = client_admin.post(f"/api/admin/enrollments/{inscription_id}/reject", {})
    espaces = client_admin.post(
        f"/api/admin/enrollments/{inscription_id}/reject", {"reason": "   "}
    )

    assert vide.status_code == 400
    assert absent.status_code == 400
    assert espaces.status_code == 400
    preuve_deposee.refresh_from_db()
    assert preuve_deposee.status == PaymentProof.Status.SUBMITTED


def test_refuser_laisse_l_inscription_en_attente_et_permet_de_renvoyer(
    client_admin: APIClient,
    client_etudiante: APIClient,
    preuve_deposee: PaymentProof,
    django_capture_on_commit_callbacks: CaptureOnCommit,
) -> None:
    mail.outbox.clear()
    inscription_id = preuve_deposee.enrollment_id

    with django_capture_on_commit_callbacks(execute=True):
        reponse = client_admin.post(
            f"/api/admin/enrollments/{inscription_id}/reject",
            {"reason": "Le montant n'est pas lisible sur la capture."},
        )

    assert reponse.status_code == 200
    preuve_deposee.refresh_from_db()
    assert preuve_deposee.status == PaymentProof.Status.REJECTED
    assert "montant" in preuve_deposee.reject_reason
    assert Enrollment.objects.get(pk=inscription_id).status == Enrollment.Status.PENDING
    assert "Le montant n'est pas lisible" in mail.outbox[0].body
    assert AuditLog.objects.filter(action=AuditLog.Action.ENROLLMENT_REJECTED).count() == 1

    # L'étudiante peut renvoyer un reçu : c'est tout l'intérêt de dire pourquoi.
    etat = client_etudiante.get("/api/enrollment/status")
    assert etat.data["depot_possible"] is True
    assert etat.data["derniere_preuve"]["reject_reason"] == preuve_deposee.reject_reason


def test_valider_une_inscription_sans_recu_est_refuse(
    client_admin: APIClient, inscription: Enrollment
) -> None:
    reponse = client_admin.post(f"/api/admin/enrollments/{inscription.pk}/accept", {})

    assert reponse.status_code == 409
    assert Enrollment.objects.get(pk=inscription.pk).status == Enrollment.Status.PENDING


def test_valider_deux_fois_ne_rejoue_pas_la_transition(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    inscription_id = preuve_deposee.enrollment_id
    client_admin.post(f"/api/admin/enrollments/{inscription_id}/accept", {})

    seconde = client_admin.post(f"/api/admin/enrollments/{inscription_id}/accept", {})

    assert seconde.status_code == 409
    assert AuditLog.objects.filter(action=AuditLog.Action.ENROLLMENT_ACCEPTED).count() == 1


def test_valider_une_inscription_inexistante_renvoie_404(client_admin: APIClient) -> None:
    assert client_admin.post("/api/admin/enrollments/999999/accept", {}).status_code == 404


def test_valider_conserve_la_note_admin(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    inscription_id = preuve_deposee.enrollment_id

    reponse = client_admin.post(
        f"/api/admin/enrollments/{inscription_id}/accept",
        {"note": "Reçu CCP lisible, montant exact.", "status": "BLOCKED", "is_staff": True},
    )

    assert reponse.status_code == 200
    inscription = Enrollment.objects.get(pk=inscription_id)
    assert inscription.note_admin == "Reçu CCP lisible, montant exact."
    assert inscription.status == Enrollment.Status.ACTIVE


def test_refuser_sans_preuve_en_examen_renvoie_409(
    client_admin: APIClient, inscription: Enrollment
) -> None:
    reponse = client_admin.post(
        f"/api/admin/enrollments/{inscription.pk}/reject", {"reason": "Illisible."}
    )

    assert reponse.status_code == 409
    assert Enrollment.objects.get(pk=inscription.pk).status == Enrollment.Status.PENDING


def test_refuser_deux_fois_ne_rejoue_pas_la_transition(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    inscription_id = preuve_deposee.enrollment_id
    client_admin.post(
        f"/api/admin/enrollments/{inscription_id}/reject", {"reason": "Montant illisible."}
    )

    seconde = client_admin.post(
        f"/api/admin/enrollments/{inscription_id}/reject", {"reason": "Toujours illisible."}
    )

    assert seconde.status_code == 409
    assert AuditLog.objects.filter(action=AuditLog.Action.ENROLLMENT_REJECTED).count() == 1


def test_refuser_une_inscription_inexistante_renvoie_404(client_admin: APIClient) -> None:
    assert (
        client_admin.post(
            "/api/admin/enrollments/999999/reject", {"reason": "Illisible."}
        ).status_code
        == 404
    )


def test_un_etudiant_ne_peut_pas_refuser_une_inscription(
    client_etudiante: APIClient, preuve_deposee: PaymentProof
) -> None:
    reponse = client_etudiante.post(
        f"/api/admin/enrollments/{preuve_deposee.enrollment_id}/reject",
        {"reason": "auto-refus"},
    )

    assert reponse.status_code == 404
    preuve_deposee.refresh_from_db()
    assert preuve_deposee.status == PaymentProof.Status.SUBMITTED


# --- Consultation du fichier -----------------------------------------------


def _entetes_preuve(client: APIClient, preuve: PaymentProof) -> dict[str, str]:
    emission = client.get(f"/api/admin/proofs/{preuve.pk}/url").data
    assert emission["path"] == f"/api/admin/proofs/{preuve.pk}/file"
    assert "?" not in emission["path"]
    return {
        "X-Proof-Expires": str(emission["expires"]),
        "X-Proof-Signature": emission["signature"],
    }


def test_l_admin_obtient_une_url_signee_et_la_consultation_est_journalisee(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    reponse = client_admin.get(f"/api/admin/proofs/{preuve_deposee.pk}/url")

    assert reponse.status_code == 200
    assert reponse.data["path"] == f"/api/admin/proofs/{preuve_deposee.pk}/file"
    assert "?" not in reponse.data["path"]
    assert reponse.data["signature"]
    assert reponse.data["expires"] > 0
    assert 0 < reponse.data["expires_in"] <= 600
    assert AuditLog.objects.filter(action=AuditLog.Action.PROOF_VIEWED).count() == 1


def test_l_url_signee_rend_le_fichier_en_piece_jointe(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    reponse = client_admin.get(
        f"/api/admin/proofs/{preuve_deposee.pk}/file",
        headers=_entetes_preuve(client_admin, preuve_deposee),
    )

    assert reponse.status_code == 200
    assert reponse["Content-Type"] == "image/jpeg"
    assert reponse["X-Content-Type-Options"] == "nosniff"
    assert "attachment" in reponse["Content-Disposition"]
    # `FileResponse` diffuse par morceaux : le corps n'est pas dans `.content`, et les
    # stubs du client de test ne connaissent que la réponse non diffusée.
    corps = b"".join(cast(Iterator[bytes], cast(Any, reponse).streaming_content))
    assert corps.startswith(b"\xff\xd8")  # marqueur de début d'un JPEG


def test_le_fichier_est_refuse_sans_signature(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    assert client_admin.get(f"/api/admin/proofs/{preuve_deposee.pk}/file").status_code == 404


def test_une_signature_en_query_string_est_ignoree(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    """Un GET recopié depuis un access log historique n'ouvre plus le fichier (§4.6)."""
    entetes = _entetes_preuve(client_admin, preuve_deposee)
    query = (
        f"/api/admin/proofs/{preuve_deposee.pk}/file"
        f"?expires={entetes['X-Proof-Expires']}"
        f"&signature={entetes['X-Proof-Signature']}"
    )

    assert client_admin.get(query).status_code == 404


def test_une_signature_emise_pour_un_autre_admin_ne_marche_pas(
    api_client: APIClient, client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    """Une URL recopiée d'un journal ou d'une capture ne sert à personne d'autre (§4.5)."""
    entetes = _entetes_preuve(client_admin, preuve_deposee)
    autre = User.objects.create_user(
        email="autre-admin@example.com", password="mot-de-passe-admin-000"
    )
    autre.is_staff = True
    autre.save(update_fields=["is_staff"])

    from apps.accounts.services import connecter as ouvrir_session

    emise = ouvrir_session(
        email=autre.email,
        password="mot-de-passe-admin-000",
        device_fingerprint="tests",
        ip_prefix="127.0.0",
    )
    api_client.cookies["access_token"] = emise.access_token

    assert (
        api_client.get(f"/api/admin/proofs/{preuve_deposee.pk}/file", headers=entetes).status_code
        == 404
    )


def test_une_signature_ne_vaut_pas_session(
    api_client: APIClient, client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    """La signature s'ajoute à l'authentification, elle ne la remplace pas (§4.3)."""
    entetes = _entetes_preuve(client_admin, preuve_deposee)

    assert (
        api_client.get(f"/api/admin/proofs/{preuve_deposee.pk}/file", headers=entetes).status_code
        == 401
    )


def test_une_preuve_purgee_n_est_plus_servie(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    from django.utils import timezone

    entetes = _entetes_preuve(client_admin, preuve_deposee)
    PaymentProof.objects.filter(pk=preuve_deposee.pk).update(purged_at=timezone.now())

    assert (
        client_admin.get(f"/api/admin/proofs/{preuve_deposee.pk}/file", headers=entetes).status_code
        == 404
    )
    assert client_admin.get(f"/api/admin/proofs/{preuve_deposee.pk}/url").status_code == 404


def test_un_identifiant_de_preuve_mal_forme_renvoie_404(client_admin: APIClient) -> None:
    assert client_admin.get("/api/admin/proofs/pas-un-uuid/url").status_code == 404
    assert client_admin.get("/api/admin/proofs/..%2F..%2Fetc%2Fpasswd/url").status_code == 404


def test_un_expires_invalide_renvoie_404(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    assert (
        client_admin.get(
            f"/api/admin/proofs/{preuve_deposee.pk}/file",
            headers={"X-Proof-Expires": "abc", "X-Proof-Signature": "00"},
        ).status_code
        == 404
    )


def test_une_preuve_dont_le_fichier_a_disparu_renvoie_404(
    client_admin: APIClient, preuve_deposee: PaymentProof
) -> None:
    from apps.enrollment.storage import stockage_preuves

    entetes = _entetes_preuve(client_admin, preuve_deposee)
    stockage_preuves().supprimer(preuve_deposee.file_key)

    assert (
        client_admin.get(f"/api/admin/proofs/{preuve_deposee.pk}/file", headers=entetes).status_code
        == 404
    )


def test_la_file_sans_filtre_renvoie_toutes_les_inscriptions(
    client_admin: APIClient, inscription: Enrollment
) -> None:
    reponse = client_admin.get("/api/admin/enrollments")

    assert reponse.status_code == 200
    assert len(reponse.data) == 1
    assert reponse.data[0]["course_title"] == inscription.course.title  # type: ignore[union-attr]


def test_une_inscription_sans_cours_a_un_titre_nul(
    client_admin: APIClient, inscription: Enrollment
) -> None:
    Enrollment.objects.filter(pk=inscription.pk).update(course=None)

    reponse = client_admin.get("/api/admin/enrollments")

    assert reponse.status_code == 200
    assert reponse.data[0]["course_title"] is None


def test_post_sur_la_file_est_refuse(client_admin: APIClient) -> None:
    assert client_admin.post("/api/admin/enrollments", {}).status_code == 405


def test_le_fichier_n_est_joignable_par_aucune_url_publique(
    api_client: APIClient, preuve_deposee: PaymentProof
) -> None:
    """§4.5 : hors URL signée + session admin, le fichier n'existe pas sur le web."""
    for chemin in (
        f"/media/{preuve_deposee.file_key}",
        f"/media/{preuve_deposee.file_key}.bin",
        f"/static/{preuve_deposee.file_key}.bin",
        f"/.preuves-privees/{preuve_deposee.file_key}.bin",
        f"/preuves/{preuve_deposee.file_key}",
        f"/api/enrollment/proof/{preuve_deposee.pk}",
        f"/api/enrollment/proofs/{preuve_deposee.pk}",
        f"/api/admin/proofs/{preuve_deposee.pk}/file",
    ):
        reponse = api_client.get(chemin)
        assert reponse.status_code in {401, 404}, chemin


def test_la_file_place_les_recus_en_examen_en_tete(
    client_admin: APIClient, inscription: Enrollment, etudiant_b: User, cours: Course
) -> None:
    sans_recu = inscription
    avec_recu = Enrollment.objects.create(
        user=etudiant_b, course=cours, status=Enrollment.Status.PENDING
    )
    client_b = connecter(APIClient(), etudiant_b)
    depot = client_b.post(
        "/api/enrollment/proof",
        {
            "file": SimpleUploadedFile("recu.jpg", image_octets(), content_type="image/jpeg"),
            "amount_declared": 12000,
        },
        format="multipart",
    )
    assert depot.status_code == 201

    reponse = client_admin.get("/api/admin/enrollments?status=PENDING")

    assert reponse.status_code == 200
    assert [ligne["id"] for ligne in reponse.data] == [avec_recu.pk, sans_recu.pk]

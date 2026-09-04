from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from pytest_django.fixtures import SettingsWrapper
from rest_framework.response import Response
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.catalog.models import Lesson
from apps.enrollment.models import Enrollment
from apps.learning.models import Progress
from apps.media.models import PlaybackToken
from apps.media.signing import SignatureImpossibleError
from apps.media.tests.conftest import VIDEO_ID, activer

pytestmark = pytest.mark.django_db


def _poster(
    client: APIClient,
    lecon: Lesson,
    *,
    ip: str = "203.0.113.10",
    empreinte: str = "appareil-a",
    corps: dict[str, object] | None = None,
) -> Response:
    return client.post(
        f"/api/lessons/{lecon.pk}/playback",
        corps or {},
        format="json",
        HTTP_X_FORWARDED_FOR=ip,
        HTTP_X_DEVICE_FINGERPRINT=empreinte,
    )


def _coeur(
    client: APIClient,
    playback_id: str,
    *,
    ip: str = "203.0.113.10",
    watched_s: int | None = None,
) -> Response:
    corps: dict[str, object] = {}
    if watched_s is not None:
        corps["watched_s"] = watched_s
    return client.post(
        f"/api/playback/{playback_id}/heartbeat",
        corps,
        format="json",
        HTTP_X_FORWARDED_FOR=ip,
    )


def test_un_anonyme_lit_le_chapitre_gratuit(api_client: APIClient, lecon_gratuite: Lesson) -> None:
    reponse = _poster(api_client, lecon_gratuite)

    assert reponse.status_code == 200
    corps = reponse.data
    assert corps["disponible"] is True
    assert corps["watermark_label"] == "visiteur"
    assert "bcdn_token=" in corps["playback_url"]
    assert VIDEO_ID in corps["playback_url"]
    assert "cle-de-test-bunny-token-auth" not in corps["playback_url"]


def test_un_anonyme_ne_lit_pas_un_chapitre_payant(
    api_client: APIClient, lecon_payante: Lesson
) -> None:
    reponse = _poster(api_client, lecon_payante)
    fantome = api_client.post("/api/lessons/999999/playback", {}, format="json")

    assert reponse.status_code == fantome.status_code == 404
    assert reponse.data == fantome.data


def test_un_compte_pending_ne_lit_pas_un_chapitre_payant(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_payante: Lesson
) -> None:
    reponse = _poster(client_etudiante, lecon_payante)
    assert reponse.status_code == 404
    assert "playback_url" not in reponse.data or "bcdn_token" not in str(reponse.data)


def test_un_compte_pending_lit_le_chapitre_gratuit(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
    etudiante: User,
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite)
    assert reponse.status_code == 200
    assert reponse.data["watermark_label"] == "etudiante · 2233"


def test_un_compte_actif_lit_un_chapitre_payant(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
) -> None:
    activer(etudiante)
    reponse = _poster(client_etudiante, lecon_payante)

    assert reponse.status_code == 200
    corps = reponse.data
    assert corps["disponible"] is True
    assert corps["duration_s"] == 600
    assert "expires=" in corps["playback_url"]


def test_une_lecon_sans_video_renvoie_disponible_faux(
    api_client: APIClient, lecon_sans_video: Lesson
) -> None:
    reponse = _poster(api_client, lecon_sans_video)
    assert reponse.status_code == 200
    assert reponse.data["disponible"] is False
    assert reponse.data["playback_url"] is None
    assert PlaybackToken.objects.count() == 0


def test_signature_impossible_devient_503_generique(
    api_client: APIClient, lecon_gratuite: Lesson, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(**kwargs: object) -> str:
        raise SignatureImpossibleError("identifiant vidéo invalide")

    monkeypatch.setattr("apps.media.services.signer_url_lecture", _boom)
    reponse = _poster(api_client, lecon_gratuite)
    assert reponse.status_code == 503
    assert reponse.data["detail"] == "Vidéo indisponible."
    assert "b-cdn" not in reponse.content.decode()
    assert PlaybackToken.objects.count() == 0


def test_cours_non_publie_est_404(api_client: APIClient, lecon_gratuite: Lesson) -> None:
    lecon_gratuite.chapter.module.course.is_published = False
    lecon_gratuite.chapter.module.course.save(update_fields=["is_published"])
    fantome = api_client.post("/api/lessons/999999/playback", {}, format="json")
    reponse = _poster(api_client, lecon_gratuite)
    assert reponse.status_code == fantome.status_code == 404
    assert reponse.data == fantome.data


def test_bunny_absent_renvoie_503_generique(
    api_client: APIClient, lecon_gratuite: Lesson, settings: SettingsWrapper
) -> None:
    settings.BUNNY_TOKEN_AUTH_KEY = ""
    reponse = _poster(api_client, lecon_gratuite)
    assert reponse.status_code == 503
    assert reponse.data["detail"] == "Vidéo indisponible."
    assert "b-cdn" not in reponse.content.decode()


def test_is_staff_dans_le_corps_n_ouvre_aucune_porte(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_payante: Lesson
) -> None:
    reponse = _poster(
        client_etudiante,
        lecon_payante,
        corps={
            "is_staff": True,
            "role": "admin",
            "status": "ACTIVE",
            "enrollment_status": "ACTIVE",
        },
    )
    assert reponse.status_code == 404


def test_get_sur_playback_reste_404(api_client: APIClient, lecon_gratuite: Lesson) -> None:
    assert api_client.get(f"/api/lessons/{lecon_gratuite.pk}/playback").status_code == 404


def test_un_second_appareil_invalide_le_premier(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
) -> None:
    activer(etudiante)
    premier = _poster(client_etudiante, lecon_payante, empreinte="appareil-a")
    assert premier.status_code == 200
    playback_id = premier.data["playback_id"]

    second = _poster(client_etudiante, lecon_payante, empreinte="appareil-b")
    assert second.status_code == 200
    assert second.data["playback_id"] != playback_id

    etudiante.refresh_from_db()
    assert etudiante.concurrent_play_attempts == 1

    coeur = _coeur(client_etudiante, playback_id)
    assert coeur.status_code == 404
    assert PlaybackToken.objects.get(pk=playback_id).consumed is True


def test_un_rafraichissement_du_meme_appareil_n_incremente_pas(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
) -> None:
    activer(etudiante)
    _poster(client_etudiante, lecon_payante, empreinte="appareil-a")
    _poster(client_etudiante, lecon_payante, empreinte="appareil-a")
    etudiante.refresh_from_db()
    assert etudiante.concurrent_play_attempts == 0
    assert PlaybackToken.objects.filter(user=etudiante, consumed=True).count() == 1


def test_heartbeat_d_un_autre_compte_est_404(
    client_etudiante: APIClient,
    client_b: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
    etudiante: User,
    etudiant_b: User,
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite)
    playback_id = reponse.data["playback_id"]
    assert _coeur(client_b, playback_id).status_code == 404


def test_heartbeat_depuis_une_autre_ip_est_404(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_gratuite: Lesson
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite, ip="203.0.113.10")
    playback_id = reponse.data["playback_id"]
    assert _coeur(client_etudiante, playback_id, ip="198.51.100.20").status_code == 404


def test_un_jeton_expire_est_404(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_gratuite: Lesson
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite)
    playback_id = reponse.data["playback_id"]
    PlaybackToken.objects.filter(pk=playback_id).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    assert _coeur(client_etudiante, playback_id).status_code == 404


def test_heartbeat_inconnu_est_404(api_client: APIClient) -> None:
    assert _coeur(api_client, str(uuid4())).status_code == 404


def test_watched_s_est_enregistre_et_repris(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
    etudiante: User,
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite)
    playback_id = reponse.data["playback_id"]
    coeur = _coeur(client_etudiante, playback_id, watched_s=42)
    assert coeur.status_code == 200
    assert coeur.data["active"] is True
    assert coeur.data["resume_at_s"] == 42

    progression = Progress.objects.get(user=etudiante, chapter=lecon_gratuite.chapter)
    assert progression.watched_s == 42
    assert progression.state == Progress.State.IN_PROGRESS

    nouveau = _poster(client_etudiante, lecon_gratuite)
    assert nouveau.data["resume_at_s"] == 42


def test_watched_s_est_borne_a_la_duree(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_gratuite: Lesson
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite)
    coeur = _coeur(client_etudiante, reponse.data["playback_id"], watched_s=10_000)
    assert coeur.data["resume_at_s"] == lecon_gratuite.duration_s


def test_watched_s_est_mis_a_jour_sur_un_second_battement(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
    etudiante: User,
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite)
    playback_id = reponse.data["playback_id"]
    _coeur(client_etudiante, playback_id, watched_s=10)
    second = _coeur(client_etudiante, playback_id, watched_s=25)
    assert second.data["resume_at_s"] == 25
    assert Progress.objects.get(user=etudiante, chapter=lecon_gratuite.chapter).watched_s == 25


def test_get_sur_heartbeat_reste_404(api_client: APIClient) -> None:
    assert api_client.get(f"/api/playback/{uuid4()}/heartbeat").status_code == 404


def test_l_emission_est_journalisee_sans_url(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
    etudiante: User,
) -> None:
    reponse = _poster(client_etudiante, lecon_gratuite)
    entree = AuditLog.objects.get(action=AuditLog.Action.PLAYBACK_ISSUED)
    assert entree.actor_id == etudiante.pk
    assert str(lecon_gratuite.pk) == entree.target_id
    assert "bcdn_token" not in str(entree.metadata)
    assert "playback_url" not in str(entree.metadata)
    assert entree.metadata["playback_id"] == reponse.data["playback_id"]


def test_un_chapitre_n_expose_plus_l_identifiant_fournisseur(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
) -> None:
    activer(etudiante)
    reponse = client_etudiante.get(f"/api/chapters/{lecon_payante.chapter.slug}")
    assert reponse.status_code == 200
    lecon = reponse.data["lesson"]
    assert lecon["id"] == lecon_payante.pk
    assert "video_provider_id" not in lecon
    assert VIDEO_ID not in reponse.content.decode()


def test_sans_empreinte_un_rafraichissement_compte_comme_concurrent(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_payante: Lesson,
    etudiante: User,
) -> None:
    """Sans cookie d'appareil, on ne peut pas distinguer un refresh d'un second écran."""
    activer(etudiante)
    assert _poster(client_etudiante, lecon_payante, empreinte="").status_code == 200
    assert _poster(client_etudiante, lecon_payante, empreinte="").status_code == 200
    etudiante.refresh_from_db()
    assert etudiante.concurrent_play_attempts == 1


def test_un_compte_ne_reprend_pas_un_jeton_anonyme(
    api_client: APIClient,
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
) -> None:
    emise = _poster(api_client, lecon_gratuite)
    assert emise.status_code == 200
    playback_id = emise.data["playback_id"]

    assert _coeur(client_etudiante, playback_id).status_code == 404
    assert _coeur(api_client, playback_id).status_code == 200


def test_un_anonyme_ne_bat_pas_le_jeton_d_un_compte(
    api_client: APIClient,
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
) -> None:
    emise = _poster(client_etudiante, lecon_gratuite)
    assert _coeur(api_client, emise.data["playback_id"]).status_code == 404


def test_heartbeat_sans_watched_s_renvoie_la_position_connue(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
    etudiante: User,
) -> None:
    emise = _poster(client_etudiante, lecon_gratuite)
    playback_id = emise.data["playback_id"]
    _coeur(client_etudiante, playback_id, watched_s=42)

    sans_position = _coeur(client_etudiante, playback_id)
    assert sans_position.status_code == 200
    assert sans_position.data["active"] is True
    assert sans_position.data["resume_at_s"] == 42
    assert Progress.objects.get(user=etudiante, chapter=lecon_gratuite.chapter).watched_s == 42


def test_heartbeat_sans_watched_s_sans_progression_renvoie_zero(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_gratuite: Lesson
) -> None:
    emise = _poster(client_etudiante, lecon_gratuite)
    coeur = _coeur(client_etudiante, emise.data["playback_id"])
    assert coeur.status_code == 200
    assert coeur.data["resume_at_s"] == 0
    assert not Progress.objects.filter(chapter=lecon_gratuite.chapter).exists()


def test_watched_s_negatif_est_refuse_en_400(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_gratuite: Lesson
) -> None:
    emise = _poster(client_etudiante, lecon_gratuite)
    reponse = client_etudiante.post(
        f"/api/playback/{emise.data['playback_id']}/heartbeat",
        {"watched_s": -1},
        format="json",
        HTTP_X_FORWARDED_FOR="203.0.113.10",
    )
    assert reponse.status_code == 400


def test_watched_s_au_dela_d_un_jour_est_refuse_en_400(
    client_etudiante: APIClient, inscription_pending: Enrollment, lecon_gratuite: Lesson
) -> None:
    emise = _poster(client_etudiante, lecon_gratuite)
    reponse = client_etudiante.post(
        f"/api/playback/{emise.data['playback_id']}/heartbeat",
        {"watched_s": 86_401},
        format="json",
        HTTP_X_FORWARDED_FOR="203.0.113.10",
    )
    assert reponse.status_code == 400


def test_un_anonyme_ignore_watched_s(api_client: APIClient, lecon_gratuite: Lesson) -> None:
    emise = _poster(api_client, lecon_gratuite)
    coeur = _coeur(api_client, emise.data["playback_id"], watched_s=90)
    assert coeur.status_code == 200
    assert coeur.data["resume_at_s"] == 0
    assert not Progress.objects.exists()


def test_bunny_hote_absent_renvoie_503_generique(
    api_client: APIClient, lecon_gratuite: Lesson, settings: SettingsWrapper
) -> None:
    settings.BUNNY_CDN_HOSTNAME = ""
    reponse = _poster(api_client, lecon_gratuite)
    assert reponse.status_code == 503
    assert reponse.data["detail"] == "Vidéo indisponible."
    assert "b-cdn" not in reponse.content.decode()


def test_telephone_court_affiche_des_tirets_dans_le_filigrane(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    lecon_gratuite: Lesson,
    etudiante: User,
) -> None:
    etudiante.phone = "12"
    etudiante.save(update_fields=["phone"])
    reponse = _poster(client_etudiante, lecon_gratuite)
    assert reponse.status_code == 200
    assert reponse.data["watermark_label"] == "etudiante · ----"

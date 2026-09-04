"""Cas limites et chemins d'erreur des trois endpoints publics de l'étape 2.

Le chemin nominal est couvert par `test_course_view` / `test_chapter_view` /
`test_leads_view` : ici on ne teste que ce qui sort du rail — méthode interdite,
payload malformé, valeur nulle, horloge falsifiée, quota par IP.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.catalog.models import Chapter, Course, Lead
from apps.catalog.services import DELAI_MINIMUM_SOUMISSION_MS

pytestmark = pytest.mark.django_db


def _payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "email": "visiteuse@example.com",
        "phone": "0555000000",
        "site": "",
        "form_rendered_at": int(time.time() * 1000) - DELAI_MINIMUM_SOUMISSION_MS - 500,
    }
    base.update(overrides)
    return base


# --------------------------------------------------------------------------- méthodes


@pytest.mark.parametrize("methode", ["post", "put", "patch", "delete"])
def test_le_detail_de_cours_est_en_lecture_seule(
    api_client: APIClient, cours: Course, methode: str
) -> None:
    """Une route publique en lecture ne doit pas laisser écrire (§4.3, deny by default)."""
    reponse = getattr(api_client, methode)(f"/api/public/course/{cours.slug}", {}, format="json")
    assert reponse.status_code == 405


@pytest.mark.parametrize("methode", ["post", "put", "patch", "delete"])
def test_le_detail_de_chapitre_est_en_lecture_seule(
    api_client: APIClient, chapitre_gratuit: Chapter, methode: str
) -> None:
    reponse = getattr(api_client, methode)(
        f"/api/public/chapters/{chapitre_gratuit.slug}", {}, format="json"
    )
    assert reponse.status_code == 405


@pytest.mark.parametrize("methode", ["get", "put", "patch", "delete"])
def test_les_leads_n_acceptent_que_post(api_client: APIClient, methode: str) -> None:
    reponse = getattr(api_client, methode)("/api/public/leads")
    assert reponse.status_code == 405


# ----------------------------------------------------------------- payloads invalides


@pytest.mark.parametrize(
    ("champ_retire", "attendu"),
    [("email", 400), ("form_rendered_at", 400)],
)
def test_champ_obligatoire_manquant_rejete(
    api_client: APIClient, champ_retire: str, attendu: int
) -> None:
    payload = _payload()
    del payload[champ_retire]

    reponse = api_client.post("/api/public/leads", payload, format="json")

    assert reponse.status_code == attendu
    assert not Lead.objects.exists()


def test_corps_vide_rejete(api_client: APIClient) -> None:
    reponse = api_client.post("/api/public/leads", {}, format="json")
    assert reponse.status_code == 400
    assert not Lead.objects.exists()


def test_form_rendered_at_non_numerique_rejete(api_client: APIClient) -> None:
    reponse = api_client.post(
        "/api/public/leads", _payload(form_rendered_at="tout-de-suite"), format="json"
    )
    assert reponse.status_code == 400
    assert not Lead.objects.exists()


def test_telephone_trop_long_rejete(api_client: APIClient) -> None:
    """`phone` fait 32 caractères en base : au-delà, 400, jamais une erreur 500."""
    reponse = api_client.post("/api/public/leads", _payload(phone="0" * 40), format="json")

    assert reponse.status_code == 400
    assert not Lead.objects.exists()


def test_telephone_absent_est_accepte(api_client: APIClient) -> None:
    """Le téléphone est facultatif sur la liste d'attente (le formulaire ne l'exige pas)."""
    payload = _payload()
    del payload["phone"]

    reponse = api_client.post("/api/public/leads", payload, format="json")

    assert reponse.status_code == 201
    assert Lead.objects.get().phone == ""


def test_le_telephone_est_nettoye_de_ses_espaces(api_client: APIClient) -> None:
    reponse = api_client.post("/api/public/leads", _payload(phone="  0555000000  "), format="json")

    assert reponse.status_code == 201
    assert Lead.objects.get().phone == "0555000000"


def test_les_champs_internes_envoyes_par_le_client_sont_ignores(api_client: APIClient) -> None:
    """§4.3 — aucun champ interne n'est accepté en entrée d'un serializer."""
    reponse = api_client.post(
        "/api/public/leads",
        _payload(id=999, ip_prefix="1.2.3", created_at="1999-01-01T00:00:00Z"),
        format="json",
    )

    assert reponse.status_code == 201
    lead = Lead.objects.get()
    assert lead.pk != 999
    assert lead.ip_prefix == "127.0.0"
    assert lead.created_at.year >= 2026


# --------------------------------------------------------------------- cas limites métier


def test_form_rendered_at_a_zero_est_traite_comme_une_page_tres_ancienne(
    api_client: APIClient,
) -> None:
    """Valeur zéro (epoch 1970) : très ancien, donc pas « trop rapide » — le lead passe.

    C'est le comportement attendu : le délai plancher protège du bot instantané, pas
    de l'onglet resté ouvert. Documenté ici pour qu'une inversion du signe se voie.
    """
    reponse = api_client.post("/api/public/leads", _payload(form_rendered_at=0), format="json")

    assert reponse.status_code == 201
    assert Lead.objects.count() == 1


def test_form_rendered_at_dans_le_futur_est_traite_comme_suspect(api_client: APIClient) -> None:
    """Horloge client falsifiée en avant : `ecoule_ms` devient négatif → recalé
    silencieusement, avec la même réponse 201 qu'un succès (pas d'oracle pour le bot).
    """
    futur = int(time.time() * 1000) + 3_600_000
    reponse = api_client.post("/api/public/leads", _payload(form_rendered_at=futur), format="json")

    assert reponse.status_code == 201
    assert reponse.json() == {"detail": "Inscrit à la liste d'attente."}
    assert not Lead.objects.exists()


def test_soumission_exactement_au_seuil_est_acceptee(api_client: APIClient) -> None:
    """Cas limite du plancher : à la milliseconde près au-dessus, on passe."""
    juste_au_dessus = int(time.time() * 1000) - DELAI_MINIMUM_SOUMISSION_MS - 50
    reponse = api_client.post(
        "/api/public/leads", _payload(form_rendered_at=juste_au_dessus), format="json"
    )

    assert reponse.status_code == 201
    assert Lead.objects.count() == 1


def test_deux_inscriptions_du_meme_email_sont_tolerees(api_client: APIClient) -> None:
    """Une liste d'attente n'est pas un compte : un doublon ne doit pas planter (500)."""
    for _ in range(2):
        reponse = api_client.post("/api/public/leads", _payload(), format="json")
        assert reponse.status_code == 201

    assert Lead.objects.filter(email="visiteuse@example.com").count() == 2


# ------------------------------------------------------------------------- limite de débit


def test_le_quota_est_par_ip_et_n_affecte_pas_les_autres_visiteurs(api_client: APIClient) -> None:
    for index in range(6):
        api_client.post(
            "/api/public/leads",
            _payload(email=f"a{index}@example.com"),
            format="json",
            HTTP_X_FORWARDED_FOR="41.100.1.1",
        )

    voisin = api_client.post(
        "/api/public/leads",
        _payload(email="voisin@example.com"),
        format="json",
        HTTP_X_FORWARDED_FOR="41.100.2.2",
    )

    assert voisin.status_code == 201


def test_les_soumissions_de_bot_consomment_aussi_le_quota(api_client: APIClient) -> None:
    """Sinon un bot qui remplit le honeypot aurait un quota illimité."""
    for index in range(5):
        reponse = api_client.post(
            "/api/public/leads",
            _payload(email=f"bot{index}@example.com", site="http://spam.example"),
            format="json",
        )
        assert reponse.status_code == 201

    depassement = api_client.post("/api/public/leads", _payload(), format="json")

    assert depassement.status_code == 429
    assert not Lead.objects.exists()


def test_le_429_ne_dit_rien_de_plus_que_reessaie(api_client: APIClient) -> None:
    for index in range(5):
        api_client.post("/api/public/leads", _payload(email=f"a{index}@example.com"), format="json")

    reponse = api_client.post("/api/public/leads", _payload(), format="json")

    assert reponse.status_code == 429
    assert reponse.json() == {"detail": "Trop de tentatives. Réessaie plus tard."}


# -------------------------------------------------------------------------- slugs hostiles


@pytest.mark.parametrize(
    "slug",
    [
        "' OR 1=1--",
        "flutter-firebase-debutants' UNION SELECT 1--",
        "<script>alert(1)</script>",
        "../../etc/passwd",
        "%2e%2e%2f",
        "0",
        "x" * 300,
    ],
)
def test_un_slug_hostile_ne_provoque_ni_500_ni_bavardage(api_client: APIClient, slug: str) -> None:
    """Injection et traversée de chemin sur les deux routes à identifiant (§8.8)."""
    for base in ["/api/public/course/", "/api/public/chapters/"]:
        reponse = api_client.get(f"{base}{slug}")
        assert reponse.status_code == 404, f"{base}{slug} → {reponse.status_code}"
        corps = reponse.content.decode(errors="ignore").lower()
        assert "traceback" not in corps
        assert "select" not in corps


def test_le_slug_est_traite_comme_une_valeur_pas_comme_du_sql(
    api_client: APIClient, cours: Course, chapitre_gratuit: Any
) -> None:
    """La table est toujours là après une tentative d'injection : rien n'a été exécuté."""
    api_client.get("/api/public/course/x'; DROP TABLE catalog_course;--")

    assert Course.objects.filter(slug=cours.slug).exists()

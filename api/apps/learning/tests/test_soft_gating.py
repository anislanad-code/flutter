"""Critères d'acceptation de l'étape 5 non couverts ailleurs (progress.md « Terminé quand »).

Trois propriétés y sont vérifiées de bout en bout :

1. **Soft gating (§2)** — sur un compte `ACTIVE`, aucun endpoint du pipeline ne renvoie
   jamais 403 pour un chapitre appartenant à un module non terminé. Le calcul
   `recommande_plus_tard` est purement cosmétique.
2. **Persistance (§5)** — l'état est recalculé côté serveur à chaque appel, il survit
   donc à un rechargement et à une session ouverte depuis un autre appareil.
3. **IDOR (§4.3, §8 point 1)** — aucun paramètre du client ne permet de lire ni d'écrire
   la progression d'un tiers.
"""

from __future__ import annotations

from typing import Any

from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course, Module
from apps.enrollment.models import Enrollment
from apps.learning import services
from apps.learning.models import ModuleCompletion, Progress

# --- 1. Soft gating : jamais de 403 -----------------------------------------


def test_complete_dun_chapitre_de_module_non_termine_reussit_sur_un_compte_actif(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    module_0: Module,
    module_1: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
) -> None:
    """§2 : le module 1 est `recommande_plus_tard`, il reste malgré tout entièrement
    utilisable. Le marquer terminé doit répondre 200 — jamais 403, jamais 404."""
    response = client_etudiante.post(f"/api/chapters/{chapitre_1a.slug}/complete")

    assert response.status_code == 200
    assert response.json()["state"] == "termine"


def test_le_pipeline_affiche_recommande_plus_tard_sans_jamais_refuser_lacces(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    module_1: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
) -> None:
    pipeline = client_etudiante.get("/api/progress", {"course": cours.slug})
    assert pipeline.status_code == 200
    assert pipeline.json()["modules"][1]["chapters"][0]["state"] == "recommande_plus_tard"

    # Le même chapitre, servi par le catalogue et marqué terminé : deux fois 200.
    assert client_etudiante.get(f"/api/chapters/{chapitre_1a.slug}").status_code == 200
    assert client_etudiante.post(f"/api/chapters/{chapitre_1a.slug}/complete").status_code == 200


def test_aucun_endpoint_du_pipeline_ne_renvoie_403_sur_un_compte_actif(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    module_1: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
) -> None:
    """Balayage complet : sur un compte actif, 403 ne doit apparaître nulle part."""
    codes = [client_etudiante.get("/api/progress", {"course": cours.slug}).status_code]
    for chapitre in (chapitre_0a, chapitre_0b, chapitre_1a):
        codes.append(client_etudiante.get(f"/api/chapters/{chapitre.slug}").status_code)
        codes.append(client_etudiante.post(f"/api/chapters/{chapitre.slug}/complete").status_code)

    assert 403 not in codes
    assert set(codes) == {200}


def test_terminer_le_dernier_chapitre_deverrouille_le_module_suivant_dans_la_reponse(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    module_1: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
) -> None:
    client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    client_etudiante.post(f"/api/chapters/{chapitre_0b.slug}/complete")

    corps = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    assert corps["modules"][1]["unlocked"] is True
    assert corps["modules"][1]["chapters"][0]["state"] == "disponible"
    assert corps["modules"][0]["completed_chapters"] == 2


# --- 2. Persistance : recalcul serveur, pas de cache -------------------------


def test_letat_du_pipeline_survit_a_un_rechargement(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
) -> None:
    client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")

    premier = client_etudiante.get("/api/progress", {"course": cours.slug}).json()
    second = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    assert premier == second
    assert premier["modules"][0]["chapters"][0]["state"] == "termine"


def test_letat_du_pipeline_survit_a_un_changement_dappareil(
    client_etudiante: APIClient,
    etudiante: User,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
) -> None:
    """Un second appareil (autre empreinte, autre préfixe IP) voit exactement le même
    pipeline : l'état vit en base, pas dans le navigateur (§4.2 interdit le stockage)."""
    from apps.accounts.services import connecter as ouvrir_session

    client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")
    depuis_le_premier = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    autre_appareil = APIClient()
    emise = ouvrir_session(
        email=etudiante.email,
        password="un-mot-de-passe-solide-123",
        device_fingerprint="un-autre-telephone",
        ip_prefix="10.0.0",
    )
    autre_appareil.cookies["access_token"] = emise.access_token

    depuis_le_second = autre_appareil.get("/api/progress", {"course": cours.slug}).json()
    assert depuis_le_second == depuis_le_premier


def test_une_reponse_de_pipeline_nest_jamais_mise_en_cache_par_un_intermediaire(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
) -> None:
    """Une réponse propre au compte ne doit pas pouvoir être servie à un autre : pas
    d'en-tête `Cache-Control: public` ni de mutualisation possible."""
    response = client_etudiante.get("/api/progress", {"course": cours.slug})
    assert "public" not in response.headers.get("Cache-Control", "").lower()


# --- 3. IDOR : aucune progression d'un tiers, ni en lecture ni en écriture ---


def test_progress_ignore_tout_parametre_didentifiant_utilisateur(
    client_etudiante: APIClient,
    etudiant_b: User,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
) -> None:
    """§8 point 1 : on tente d'orienter la lecture vers B par tous les noms plausibles."""
    Enrollment.objects.create(user=etudiant_b, course=cours, status=Enrollment.Status.ACTIVE)
    services.terminer_chapitre(user=etudiant_b, chapter=chapitre_0a)

    for cle in ("user", "user_id", "student", "student_id", "for_user"):
        response = client_etudiante.get(
            "/api/progress", {"course": cours.slug, cle: str(etudiant_b.pk)}
        )
        assert response.status_code == 200
        etats = {c["slug"]: c["state"] for c in response.json()["modules"][0]["chapters"]}
        assert etats[chapitre_0a.slug] == "disponible", f"fuite via ?{cle}="


def test_complete_ignore_tout_identifiant_utilisateur_dans_le_corps(
    client_etudiante: APIClient,
    etudiante: User,
    etudiant_b: User,
    inscription_active: Enrollment,
    chapitre_0a: Chapter,
) -> None:
    """§4.3 : on n'écrit jamais ailleurs que sur `request.user`, quoi qu'envoie le client."""
    response = client_etudiante.post(
        f"/api/chapters/{chapitre_0a.slug}/complete",
        {"user": etudiant_b.pk, "user_id": etudiant_b.pk, "state": "NOT_STARTED"},
        format="json",
    )

    assert response.status_code == 200
    assert Progress.objects.filter(user=etudiante, chapter=chapitre_0a).exists()
    assert not Progress.objects.filter(user=etudiant_b).exists()


def test_complete_nefface_pas_la_progression_dun_tiers_sur_le_meme_chapitre(
    client_etudiante: APIClient,
    client_b: APIClient,
    etudiant_b: User,
    inscription_active: Enrollment,
    cours: Course,
    chapitre_0a: Chapter,
) -> None:
    Enrollment.objects.create(user=etudiant_b, course=cours, status=Enrollment.Status.ACTIVE)
    services.enregistrer_position(
        user=etudiant_b, chapter=chapitre_0a, watched_s=42, duration_s=480
    )

    client_etudiante.post(f"/api/chapters/{chapitre_0a.slug}/complete")

    progression_b = Progress.objects.get(user=etudiant_b, chapter=chapitre_0a)
    assert progression_b.state == Progress.State.IN_PROGRESS
    assert progression_b.watched_s == 42


# --- Invariantes rejouées à chaque étape (CLAUDE.md §4.4, §4.1) --------------


def _valeurs(noeud: Any) -> list[Any]:
    if isinstance(noeud, dict):
        return [*noeud.keys(), *(v for sous in noeud.values() for v in _valeurs(sous))]
    if isinstance(noeud, list):
        return [v for sous in noeud for v in _valeurs(sous)]
    return [noeud]


def test_le_pipeline_ne_fuit_ni_is_correct_ni_url_video_ni_transcript(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    module_1: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
) -> None:
    brut = client_etudiante.get("/api/progress", {"course": cours.slug}).content.decode()

    for interdit in ("is_correct", "video_provider_id", "transcript", ".mp4", "mediadelivery"):
        assert interdit not in brut


def test_un_compte_pending_ne_voit_pas_le_pipeline_dun_contenu_payant_par_cette_route(
    client_etudiante: APIClient,
    inscription_pending: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
) -> None:
    """La route n'expose que des titres et des états — jamais du contenu de chapitre
    (§4.4 : l'API de contenu renvoie un chapitre à la fois, et le paywall reste ailleurs).
    On le vérifie explicitement pour un compte qui n'a pas payé."""
    corps = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    for module in corps["modules"]:
        for chapitre in module["chapters"]:
            assert set(chapitre) == {
                "id",
                "slug",
                "order",
                "title",
                "is_free",
                "state",
                "quiz_id",
            }


def test_progress_404_quand_le_cours_est_depublie(
    client_etudiante: APIClient, inscription_active: Enrollment, cours: Course
) -> None:
    cours.is_published = False
    cours.save(update_fields=["is_published"])

    assert client_etudiante.get("/api/progress", {"course": cours.slug}).status_code == 404


def test_progress_404_sans_parametre_course(
    client_etudiante: APIClient, inscription_active: Enrollment, cours: Course
) -> None:
    assert client_etudiante.get("/api/progress").status_code == 404


def test_complete_refuse_un_appel_anonyme(api_client: APIClient, chapitre_0a: Chapter) -> None:
    assert api_client.post(f"/api/chapters/{chapitre_0a.slug}/complete").status_code == 401


# --- Cas limites du calcul --------------------------------------------------


def test_un_module_vide_affiche_zero_sur_zero_sans_planter(
    client_etudiante: APIClient,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
) -> None:
    corps = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    assert corps["modules"][0]["total_chapters"] == 0
    assert corps["modules"][0]["completed_chapters"] == 0
    assert corps["modules"][0]["chapters"] == []
    assert corps["resume_chapter_slug"] is None


def test_un_module_vide_deverrouille_quand_meme_le_module_suivant(
    etudiante: User, cours: Course, module_0: Module, module_1: Module, chapitre_1a: Chapter
) -> None:
    """Décision explicite du service : « aucun chapitre » compte comme « tout terminé »
    (vérité vacueuse), pas l'inverse — sinon un module en cours de rédaction (état
    normal pendant que le contenu se sème, cf. seed de l'étape 2) verrouillerait toute
    la suite de la formation, définitivement, sans qu'aucun étudiant ne puisse rien y
    faire (§8 relecture étape 5, MAJEUR 9)."""
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)

    assert pipeline.modules[0].unlocked is True
    assert pipeline.modules[1].unlocked is True


def test_une_formation_sans_module_renvoie_un_pipeline_vide(
    client_etudiante: APIClient, inscription_active: Enrollment, cours: Course
) -> None:
    corps = client_etudiante.get("/api/progress", {"course": cours.slug}).json()

    assert corps == {
        "course_slug": cours.slug,
        "resume_chapter_slug": None,
        "modules": [],
    }


def test_terminer_un_chapitre_sans_lecon_ne_plante_pas(
    client_etudiante: APIClient, inscription_active: Enrollment, module_0: Module
) -> None:
    """Un chapitre publié avant sa vidéo : `duration_s` n'existe pas, `watched_s` vaut 0."""
    sans_lecon = Chapter.objects.create(
        module=module_0, slug="chapitre-sans-video", order=9, title="Bientôt", is_free=True
    )

    response = client_etudiante.post(f"/api/chapters/{sans_lecon.slug}/complete")

    assert response.status_code == 200
    progression = Progress.objects.get(chapter=sans_lecon)
    assert progression.state == Progress.State.DONE
    assert progression.watched_s == 0


def test_module_completion_se_lit_dans_ladmin(etudiante: User, module_0: Module) -> None:
    """`ModuleCompletion` est posé pour l'étape 6 : on vérifie au moins son libellé."""
    completion = ModuleCompletion.objects.create(user=etudiante, module=module_0)
    assert "en cours" in str(completion)

    completion.exam_passed = True
    completion.save(update_fields=["exam_passed"])
    assert "réussi" in str(completion)


def test_une_inscription_active_sur_une_formation_ne_donne_acces_a_aucune_autre(
    client_etudiante: APIClient, inscription_active: Enrollment, cours: Course
) -> None:
    """§8 relecture étape 5, ÉLEVÉ E1 : le paywall se lit par `(user, course)`, jamais
    par `user` seul. Une deuxième formation payante, publiée, reste hors d'atteinte
    d'un compte actif uniquement sur la première — ni en lecture du pipeline, ni en
    écriture d'une complétion."""
    autre_cours = Course.objects.create(
        slug="react-native-avance",
        title="React Native avancé",
        description="Deuxième formation.",
        is_published=True,
    )
    autre_module = Module.objects.create(course=autre_cours, order=0, title="Module payant")
    autre_chapitre = Chapter.objects.create(
        module=autre_module, slug="rn-chapitre-payant", order=1, title="Payant F2", is_free=False
    )

    assert client_etudiante.get(f"/api/chapters/{autre_chapitre.slug}").status_code == 404
    assert client_etudiante.post(f"/api/chapters/{autre_chapitre.slug}/complete").status_code == 404
    # Le pipeline de l'autre formation reste lisible (structure déjà publique par
    # `/api/public/course/{slug}`, §4.4), mais le chapitre payant n'y est jamais
    # « disponible » pour un compte qui ne l'a pas payée — recommandé plus tard, comme
    # un module non débloqué, jamais un mensonge d'accès.
    corps = client_etudiante.get("/api/progress", {"course": autre_cours.slug}).json()
    assert corps["modules"][0]["chapters"][0]["state"] == "recommande_plus_tard"
    assert not Progress.objects.filter(chapter=autre_chapitre).exists()


def test_ladmin_django_interdit_de_falsifier_ou_supprimer_la_progression() -> None:
    """§4.6 : la progression conditionnera un certificat (étape 8) — l'admin la
    consulte, il ne la modifie ni ne la supprime depuis cette interface, comme
    `PlaybackTokenAdmin` (étape 4)."""
    from django.contrib import admin as django_admin

    from apps.learning.admin import ModuleCompletionAdmin, ProgressAdmin

    for interface in (
        ProgressAdmin(Progress, django_admin.site),
        ModuleCompletionAdmin(ModuleCompletion, django_admin.site),
    ):
        assert interface.has_add_permission(None) is False  # type: ignore[arg-type]
        assert interface.has_change_permission(None) is False  # type: ignore[arg-type]
        assert interface.has_delete_permission(None) is False  # type: ignore[arg-type]

"""Invariantes de CLAUDE.md §4, à rejouer à chaque étape même si l'étape n'y touche pas.

À l'étape 1, `Choice`, `Lesson` et `Chapter` n'existent pas encore : ces tests sont donc
des sentinelles. Ils resteront verts tant que rien n'est introduit, et deviendront des
tests de contenu réels dès l'étape 2 — sans qu'on ait à penser à les écrire ce jour-là.
Une sentinelle qui échoue signale exactement le moment où l'invariante devient exigible.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from django.urls import get_resolver
from rest_framework.test import APIClient

from apps.accounts.models import User

RACINE_APPS = Path(__file__).resolve().parents[3] / "apps"


def _sources_python() -> list[Path]:
    return [
        chemin
        for chemin in RACINE_APPS.rglob("*.py")
        if "/tests/" not in chemin.as_posix() and "/migrations/" not in chemin.as_posix()
    ]


def test_aucun_serializer_n_expose_is_correct() -> None:
    """§4.4 — les bonnes réponses ne quittent jamais le serveur avant soumission."""
    coupables = [
        chemin
        for chemin in _sources_python()
        if chemin.name in {"serializers.py", "views.py"} and "is_correct" in chemin.read_text()
    ]

    assert coupables == [], f"`is_correct` apparaît dans {coupables}"


def test_aucune_url_de_fichier_video_dans_les_serializers_ou_les_vues() -> None:
    """§4.1.1 — aucune URL de fichier vidéo ne transite vers le client."""
    motif = re.compile(r"\.(mp4|m3u8|mkv|webm)\b|b-cdn\.net|video\.bunnycdn\.com")
    coupables = [
        chemin.as_posix()
        for chemin in _sources_python()
        if chemin.name in {"serializers.py", "views.py"} and motif.search(chemin.read_text())
    ]

    assert coupables == [], f"URL de média brute dans {coupables}"


def test_aucune_route_ne_permet_de_definir_le_mot_de_passe_d_un_tiers() -> None:
    """§4.2 — l'admin peut envoyer un lien de reset, jamais choisir un mot de passe.

    On inspecte la table de routage complète plutôt que des noms devinés : une route
    ajoutée dans une autre application serait attrapée ici aussi.
    """
    motifs_interdits = re.compile(r"set-?password|change-?password|users?/[^/]+/password")

    def parcourir(patterns: object, prefixe: str = "") -> list[str]:
        trouvees: list[str] = []
        for motif in patterns:  # type: ignore[attr-defined]
            chemin = prefixe + str(motif.pattern)
            sous_patterns = getattr(motif, "url_patterns", None)
            if sous_patterns is not None:
                trouvees.extend(parcourir(sous_patterns, chemin))
            else:
                trouvees.append(chemin)
        return trouvees

    routes = parcourir(get_resolver().url_patterns)

    assert routes, "la table de routage est vide, le test ne prouve rien"
    coupables = [route for route in routes if motifs_interdits.search(route)]
    assert coupables == [], f"routes suspectes : {coupables}"


@pytest.mark.django_db
def test_me_ne_renvoie_aucun_champ_interne(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    """§4.3 — pas de champ interne, pas de secret, pas de signal d'administration."""
    connexion = api_client.post(
        "/api/auth/login",
        {"email": utilisateur.email, "password": mot_de_passe},
        format="json",
    )
    api_client.cookies["access_token"] = connexion.data["access_token"]
    reponse = api_client.get("/api/me")

    assert reponse.status_code == 200
    corps = reponse.json()
    for champ_interdit in [
        "password",
        "flagged_for_review",
        "is_superuser",
        "groups",
        "user_permissions",
        "refresh_token_hash",
        "token_hash",
    ]:
        assert champ_interdit not in corps, f"/api/me expose {champ_interdit}"


@pytest.mark.django_db
def test_un_compte_pending_n_a_encore_acces_a_aucun_contenu(
    api_client: APIClient, utilisateur: User, mot_de_passe: str
) -> None:
    """§4.4 — sentinelle : tant que le catalogue n'existe pas, aucune route de contenu
    ne doit répondre autre chose que 404 à un compte fraîchement inscrit (PENDING).
    """
    connexion = api_client.post(
        "/api/auth/login",
        {"email": utilisateur.email, "password": mot_de_passe},
        format="json",
    )
    api_client.cookies["access_token"] = connexion.data["access_token"]

    for chemin in [
        "/api/chapters/1",
        "/api/public/chapters/1",
        "/api/lessons/1",
        "/api/lessons/1/playback",
        "/api/courses/flutter-firebase",
    ]:
        reponse = api_client.get(chemin)
        assert reponse.status_code == 404, f"{chemin} répond {reponse.status_code}"

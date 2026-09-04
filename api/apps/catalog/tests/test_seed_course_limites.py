"""`seed_course` vu comme une transition d'état : réussit, est idempotente, atomique.

`test_seed_course.py` couvre le chemin nominal et le double appel. Ici : ce que le
rejeu répare, ce qu'il ne détruit pas, et le fait que la commande ne laisse jamais
une formation à moitié semée.
"""

from __future__ import annotations

from io import StringIO
from typing import Any
from unittest.mock import patch

import pytest
from django.core.management import call_command

from apps.catalog.models import Chapter, Course, Lesson, Module

pytestmark = pytest.mark.django_db


def test_la_commande_annonce_ce_qu_elle_a_seme() -> None:
    sortie = StringIO()
    call_command("seed_course", stdout=sortie)

    assert "semée" in sortie.getvalue()


def test_le_rejeu_repare_un_contenu_modifie_a_la_main() -> None:
    """Idempotence utile : rejouer remet le titre de référence, sans créer de doublon."""
    call_command("seed_course")
    Course.objects.filter(slug="flutter-firebase-debutants").update(
        title="Titre cassé", is_published=False
    )

    call_command("seed_course")

    cours = Course.objects.get(slug="flutter-firebase-debutants")
    assert cours.title == "Flutter + Firebase pour débutants absolus"
    assert cours.is_published is True
    assert Course.objects.count() == 1


def test_le_rejeu_ne_detruit_pas_une_video_deja_deposee_sur_un_chapitre_payant() -> None:
    """Les leçons payantes sont posées en `get_or_create` : le rejeu ne doit pas
    effacer un `video_provider_id` renseigné plus tard (étape 4).
    """
    call_command("seed_course")
    lecon = Lesson.objects.get(chapter__slug="ton-premier-widget")
    lecon.video_provider_id = "bunny-42"
    lecon.save(update_fields=["video_provider_id"])

    call_command("seed_course")

    lecon.refresh_from_db()
    assert lecon.video_provider_id == "bunny-42"


def test_un_seul_chapitre_est_gratuit_dans_toute_la_formation() -> None:
    """§4.4 — l'exception au paywall reste une exception."""
    call_command("seed_course")

    gratuits = list(Chapter.objects.filter(is_free=True).values_list("slug", flat=True))

    assert gratuits == ["installer-flutter-et-configurer-ton-editeur"]


def test_la_structure_semee_est_celle_de_la_formation_reelle() -> None:
    call_command("seed_course")

    cours = Course.objects.get(slug="flutter-firebase-debutants")
    modules = list(cours.modules.all())

    assert [m.order for m in modules] == [0, 1]
    assert modules[0].title == "Mise en route"
    assert [c.order for c in modules[0].chapters.all()] == [1, 2, 3]
    # Chaque chapitre a sa leçon : pas de nœud vide dans le parcours affiché.
    assert Lesson.objects.count() == Chapter.objects.count() == 6
    assert all(lecon.duration_s > 0 for lecon in Lesson.objects.all())


def test_le_transcript_du_chapitre_gratuit_est_du_vrai_contenu() -> None:
    """« Pas de lorem ipsum » est un critère de sortie de l'étape 2 (progress.md)."""
    call_command("seed_course")

    transcript = Lesson.objects.get(
        chapter__slug="installer-flutter-et-configurer-ton-editeur"
    ).transcript

    assert len(transcript) > 500
    assert "lorem" not in transcript.lower()
    assert "flutter doctor" in transcript


def test_un_echec_en_milieu_de_commande_ne_laisse_rien_derriere_lui() -> None:
    """§7 — toute transition d'état est atomique : pas de formation à moitié semée."""
    with patch.object(Lesson.objects, "get_or_create", side_effect=RuntimeError("disque plein")):
        with pytest.raises(RuntimeError):
            call_command("seed_course")

    assert not Course.objects.exists()
    assert not Module.objects.exists()
    assert not Chapter.objects.exists()
    assert not Lesson.objects.exists()


def test_le_rejeu_apres_un_echec_repart_proprement() -> None:
    appels: dict[str, int] = {"n": 0}
    vrai_get_or_create = Lesson.objects.get_or_create

    def echoue_au_troisieme(*args: Any, **kwargs: Any) -> Any:
        appels["n"] += 1
        if appels["n"] == 1:
            raise RuntimeError("coupure réseau")
        return vrai_get_or_create(*args, **kwargs)

    with patch.object(Lesson.objects, "get_or_create", side_effect=echoue_au_troisieme):
        with pytest.raises(RuntimeError):
            call_command("seed_course")

    call_command("seed_course")

    assert Chapter.objects.count() == 6

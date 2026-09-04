"""Calcul du pipeline et complétion (CLAUDE.md §7 : logique testée hors des vues)."""

from __future__ import annotations

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course, Module
from apps.enrollment.models import Enrollment
from apps.learning import services
from apps.learning.models import Progress


def test_premier_module_toujours_deverrouille(
    etudiante: User, cours: Course, module_0: Module, chapitre_0a: Chapter, chapitre_0b: Chapter
) -> None:
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    assert pipeline.modules[0].unlocked is True


def test_chapitre_non_commence_dans_module_deverrouille_est_disponible(
    etudiante: User,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
) -> None:
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    etats = {c.chapter.slug: c.state for c in pipeline.modules[0].chapters}
    assert etats["installer-flutter"] == "disponible"
    assert etats["premier-widget"] == "disponible"


def test_module_suivant_recommande_tant_que_le_precedent_nest_pas_termine(
    etudiante: User,
    cours: Course,
    module_0: Module,
    module_1: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
) -> None:
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    module_suivant = pipeline.modules[1]
    assert module_suivant.unlocked is False
    assert module_suivant.chapters[0].state == "recommande_plus_tard"


def test_module_suivant_se_deverrouille_quand_tous_les_chapitres_precedents_sont_termines(
    etudiante: User,
    inscription_active: Enrollment,
    cours: Course,
    module_0: Module,
    module_1: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
    chapitre_1a: Chapter,
) -> None:
    services.terminer_chapitre(user=etudiante, chapter=chapitre_0a)
    services.terminer_chapitre(user=etudiante, chapter=chapitre_0b)

    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    assert pipeline.modules[1].unlocked is True
    assert pipeline.modules[1].chapters[0].state == "disponible"
    # Le module devenu déverrouillé reste malgré tout entièrement cliquable côté
    # frontend même s'il ne l'était pas — ce n'est pas testé ici (c'est une propriété
    # du composant), seul l'état affiché est vérifié.


def test_chapitre_en_cours_de_lecture_est_en_cours(
    etudiante: User, cours: Course, module_0: Module, chapitre_0a: Chapter, chapitre_0b: Chapter
) -> None:
    services.enregistrer_position(user=etudiante, chapter=chapitre_0a, watched_s=30, duration_s=480)
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    etats = {c.chapter.slug: c.state for c in pipeline.modules[0].chapters}
    assert etats["installer-flutter"] == "en_cours"


def test_terminer_chapitre_est_idempotent(etudiante: User, chapitre_0a: Chapter) -> None:
    services.terminer_chapitre(user=etudiante, chapter=chapitre_0a)
    premiere = Progress.objects.get(user=etudiante, chapter=chapitre_0a)

    services.terminer_chapitre(user=etudiante, chapter=chapitre_0a)
    seconde = Progress.objects.get(user=etudiante, chapter=chapitre_0a)

    assert Progress.objects.filter(user=etudiante, chapter=chapitre_0a).count() == 1
    assert seconde.state == Progress.State.DONE
    assert premiere.completed_at is not None


def test_terminer_chapitre_ne_redescend_jamais_watched_s(
    etudiante: User, chapitre_0a: Chapter
) -> None:
    services.enregistrer_position(
        user=etudiante, chapter=chapitre_0a, watched_s=480, duration_s=480
    )
    services.terminer_chapitre(user=etudiante, chapter=chapitre_0a)
    services.enregistrer_position(user=etudiante, chapter=chapitre_0a, watched_s=5, duration_s=480)

    progression = Progress.objects.get(user=etudiante, chapter=chapitre_0a)
    assert progression.state == Progress.State.DONE
    assert progression.watched_s == 480


def test_resume_chapter_slug_pointe_le_chapitre_en_cours(
    etudiante: User, cours: Course, module_0: Module, chapitre_0a: Chapter, chapitre_0b: Chapter
) -> None:
    services.enregistrer_position(user=etudiante, chapter=chapitre_0b, watched_s=60, duration_s=600)
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    assert pipeline.resume_chapter_slug == "premier-widget"


def test_resume_chapter_slug_retombe_sur_le_premier_disponible_si_rien_en_cours(
    etudiante: User, cours: Course, module_0: Module, chapitre_0a: Chapter, chapitre_0b: Chapter
) -> None:
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    assert pipeline.resume_chapter_slug == "installer-flutter"


def test_resume_chapter_slug_est_nul_si_tout_est_termine(
    etudiante: User, cours: Course, module_0: Module, chapitre_0a: Chapter, chapitre_0b: Chapter
) -> None:
    services.terminer_chapitre(user=etudiante, chapter=chapitre_0a)
    services.terminer_chapitre(user=etudiante, chapter=chapitre_0b)
    pipeline = services.calculer_pipeline(user=etudiante, course=cours)
    assert pipeline.resume_chapter_slug is None


def test_progression_dun_etudiant_nest_jamais_visible_pour_un_autre(
    etudiante: User,
    etudiant_b: User,
    cours: Course,
    module_0: Module,
    chapitre_0a: Chapter,
    chapitre_0b: Chapter,
) -> None:
    services.terminer_chapitre(user=etudiante, chapter=chapitre_0a)

    pipeline_b = services.calculer_pipeline(user=etudiant_b, course=cours)
    etats_b = {c.chapter.slug: c.state for c in pipeline_b.modules[0].chapters}
    assert etats_b["installer-flutter"] == "disponible"

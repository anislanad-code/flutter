"""Position de lecture et calcul du pipeline (CLAUDE.md §7 : jamais dans les vues).

Le déverrouillage de modules est en **soft gating** (§2) : un module non recommandé
reste entièrement accessible, l'état calculé ici ne sert qu'à l'affichage.
`calculer_pipeline` consulte `a_acces_au_contenu` pour cette même raison — décider quel
texte afficher — jamais pour refuser un accès : c'est le rôle exclusif des vues
(`ChapterCompleteView`, `ChapterDetailView`) et du paywall (§4.4).
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course
from apps.enrollment.services import a_acces_au_contenu
from apps.learning.models import Progress

# --- Position de lecture (étape 4) ------------------------------------------


def position_de(user: User, chapter: Chapter) -> int:
    progression = Progress.objects.filter(user=user, chapter=chapter).first()
    return progression.watched_s if progression is not None else 0


def enregistrer_position(*, user: User, chapter: Chapter, watched_s: int, duration_s: int) -> int:
    """Enregistre `watched_s`, borné à la durée. Passe en `IN_PROGRESS` au premier tick.

    Renvoie la valeur réellement stockée.
    """
    borne = max(0, watched_s)
    if duration_s > 0:
        borne = min(borne, duration_s)

    maintenant = timezone.now()
    defaults = {
        "watched_s": borne,
        "state": Progress.State.IN_PROGRESS if borne > 0 else Progress.State.NOT_STARTED,
        "updated_at": maintenant,
    }
    try:
        progression, created = Progress.objects.get_or_create(
            user=user,
            chapter=chapter,
            defaults=defaults,
        )
    except IntegrityError:
        progression = Progress.objects.get(user=user, chapter=chapter)
        created = False
    if created:
        return borne
    if progression.state == Progress.State.DONE:
        # Un chapitre terminé ne redescend jamais à `IN_PROGRESS` parce qu'un
        # `heartbeat` tardif arrive après coup (lecture en boucle, relecture).
        return progression.watched_s
    champs = ["watched_s", "updated_at"]
    progression.watched_s = borne
    progression.updated_at = maintenant
    if borne > 0 and progression.state == Progress.State.NOT_STARTED:
        progression.state = Progress.State.IN_PROGRESS
        champs.append("state")
    progression.save(update_fields=champs)
    return borne


# --- Complétion et pipeline (étape 5) ---------------------------------------


def _duree(chapter: Chapter) -> int:
    lecon = getattr(chapter, "lesson", None)
    return lecon.duration_s if lecon is not None else 0


@transaction.atomic
def terminer_chapitre(*, user: User, chapter: Chapter) -> Progress:
    """Marque le chapitre `DONE`. Idempotent : rejouer l'appel ne change rien de plus."""
    maintenant = timezone.now()
    duree = _duree(chapter)
    progression, created = Progress.objects.select_for_update().get_or_create(
        user=user,
        chapter=chapter,
        defaults={
            "state": Progress.State.DONE,
            "watched_s": duree,
            "completed_at": maintenant,
            "updated_at": maintenant,
        },
    )
    if created or progression.state == Progress.State.DONE:
        return progression

    progression.state = Progress.State.DONE
    progression.watched_s = max(progression.watched_s, duree)
    progression.completed_at = maintenant
    progression.updated_at = maintenant
    progression.save(update_fields=["state", "watched_s", "completed_at", "updated_at"])
    return progression


@dataclass(frozen=True)
class EtatChapitre:
    chapter: Chapter
    state: str  # "termine" | "en_cours" | "disponible" | "recommande_plus_tard"


@dataclass(frozen=True)
class EtatModule:
    module_id: int
    order: int
    title: str
    unlocked: bool
    completed_chapters: int
    total_chapters: int
    chapters: list[EtatChapitre]
    # Ordre du module précédent, celui dont la complétion déverrouillerait celui-ci.
    # `None` quand `unlocked` est vrai (rien à recommander). Sert à l'infobulle
    # « Termine d'abord le module N » (§6) — jamais le module lui-même.
    recommande_apres_ordre: int | None


@dataclass(frozen=True)
class EtatPipeline:
    course_slug: str
    modules: list[EtatModule]
    resume_chapter_slug: str | None


def _etat_chapitre(progress_state: str | None, module_unlocked: bool, accessible: bool) -> str:
    if progress_state == Progress.State.DONE:
        return "termine"
    if progress_state == Progress.State.IN_PROGRESS:
        return "en_cours"
    return "disponible" if module_unlocked and accessible else "recommande_plus_tard"


def calculer_pipeline(*, user: User, course: Course) -> EtatPipeline:
    """État de chaque nœud du serpentin pour `user`, calculé côté serveur (§6).

    Un module est déverrouillé (`unlocked`) si c'est le premier de la formation, ou si
    tous les chapitres du module précédent sont `DONE` (un module sans chapitre compte
    comme complet : rien à y terminer ne doit pas verrouiller la suite indéfiniment).
    Un module verrouillé reste entièrement cliquable — `unlocked` ne pilote que
    l'opacité et l'infobulle « recommandé plus tard », jamais un refus côté serveur
    (§2). Un chapitre payant qu'`user` n'a pas le droit de voir (§4.4) est traité comme
    « recommandé plus tard » lui aussi : ce n'est ni un mensonge (il n'est pas
    disponible tant que la formation n'est pas payée) ni une fuite (seuls titre et
    ordre, déjà publics, sortent de ce point d'API).
    """
    acces = a_acces_au_contenu(user, course)
    # `.all()` seul, sans `.order_by()` : l'ordre déclaré par `Chapter.Meta.ordering`
    # et `Module.Meta.ordering` s'applique déjà, et poser un `order_by` explicite ici
    # invaliderait le cache de `prefetch_related` (Django le traite comme une requête
    # différente) — la moitié du gain du prefetch partait en fumée pour rien.
    modules_qs = list(course.modules.prefetch_related("chapters").all())
    etats = {
        (p.chapter_id): p.state
        for p in Progress.objects.filter(user=user, chapter__module__course=course)
    }

    resultats: list[EtatModule] = []
    module_precedent_complet = True
    ordre_module_precedent: int | None = None
    resume: tuple[int, str] | None = None  # (ordre_module, slug) du prochain nœud à reprendre
    resume_fallback: tuple[int, str] | None = None

    for mod in modules_qs:
        chapitres = list(mod.chapters.all())
        unlocked = module_precedent_complet

        chapitre_etats: list[EtatChapitre] = []
        termines = 0
        for chap in chapitres:
            progress_state = etats.get(chap.id)
            accessible = acces or chap.is_free
            etat = _etat_chapitre(progress_state, unlocked, accessible)
            chapitre_etats.append(EtatChapitre(chapter=chap, state=etat))
            if etat == "termine":
                termines += 1
            if etat == "en_cours" and resume is None:
                resume = (mod.order, chap.slug)
            if etat == "disponible" and resume_fallback is None:
                resume_fallback = (mod.order, chap.slug)

        resultats.append(
            EtatModule(
                module_id=mod.id,
                order=mod.order,
                title=mod.title,
                unlocked=unlocked,
                completed_chapters=termines,
                total_chapters=len(chapitres),
                chapters=chapitre_etats,
                recommande_apres_ordre=None if unlocked else ordre_module_precedent,
            )
        )
        module_precedent_complet = termines == len(chapitres)
        ordre_module_precedent = mod.order

    return EtatPipeline(
        course_slug=course.slug,
        modules=resultats,
        resume_chapter_slug=(resume or resume_fallback or (None, None))[1],
    )

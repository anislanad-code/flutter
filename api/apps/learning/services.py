"""Position de lecture. Pas de transition d'état métier ici (étape 5)."""

from __future__ import annotations

from django.db import IntegrityError
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Chapter
from apps.learning.models import Progress


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
    champs = ["watched_s", "updated_at"]
    progression.watched_s = borne
    progression.updated_at = maintenant
    if borne > 0 and progression.state == Progress.State.NOT_STARTED:
        progression.state = Progress.State.IN_PROGRESS
        champs.append("state")
    progression.save(update_fields=champs)
    return borne

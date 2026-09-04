"""Émission et contrôle des jetons de lecture (CLAUDE.md §4.1). Toute la logique
vit ici : les vues ne font que traduire les erreurs en HTTP.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.http import Http404
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.throttling import enforce_rate_limit
from apps.audit.models import AuditLog
from apps.audit.services import journaliser
from apps.catalog.models import Lesson
from apps.enrollment import services as enrollment_services
from apps.learning import services as learning_services
from apps.media.models import PlaybackToken
from apps.media.signing import SignatureImpossibleError, signer_url_lecture


class LectureRefuseeError(Exception):
    """Pas le droit, ou la leçon n'existe pas. Toujours traduite en 404 identique."""


class BunnyNonConfigureError(Exception):
    """Vidéo déposée, mais la signature Bunny n'est pas configurée."""


class JetonInvalideError(Exception):
    """Heartbeat : jeton inconnu, expiré, consommé, mauvaise IP ou mauvais compte."""


@dataclass(frozen=True, slots=True)
class Lecture:
    disponible: bool
    playback_id: UUID | None
    playback_url: str | None
    expires_at: datetime | None
    watermark_label: str
    resume_at_s: int
    duration_s: int


@dataclass(frozen=True, slots=True)
class Battement:
    active: bool
    expires_at: datetime
    resume_at_s: int


def libelle_filigrane(user: User | None) -> str:
    """`local-part de l'email · 4 derniers chiffres du téléphone` — ou `visiteur`."""
    if user is None:
        return "visiteur"
    local = user.email.split("@", 1)[0]
    chiffres = "".join(caractere for caractere in user.phone if caractere.isdigit())
    suffixe = chiffres[-4:] if len(chiffres) >= 4 else "----"
    return f"{local} · {suffixe}"


def _lecon_ou_404(lesson_id: int) -> Lesson:
    try:
        return Lesson.objects.select_related("chapter", "chapter__module__course").get(pk=lesson_id)
    except Lesson.DoesNotExist:
        raise LectureRefuseeError from None


def _a_le_droit(user: User | None, lecon: Lesson) -> bool:
    chapitre = lecon.chapter
    if not chapitre.module.course.is_published:
        return False
    if chapitre.is_free:
        return True
    if user is None:
        return False
    return enrollment_services.a_acces_au_contenu(user)


def _plafonner_emission(user: User | None, ip: str) -> None:
    enforce_rate_limit(
        "playback:burst:ip",
        ip or "inconnue",
        max_attempts=settings.PLAYBACK_RATE_LIMIT_BURST,
        window_seconds=settings.PLAYBACK_RATE_LIMIT_BURST_WINDOW_SECONDS,
    )
    enforce_rate_limit(
        "playback:hour:ip",
        ip or "inconnue",
        max_attempts=settings.PLAYBACK_RATE_LIMIT_HOURLY,
        window_seconds=3600,
    )
    if user is not None:
        enforce_rate_limit(
            "playback:burst:user",
            str(user.pk),
            max_attempts=settings.PLAYBACK_RATE_LIMIT_BURST,
            window_seconds=settings.PLAYBACK_RATE_LIMIT_BURST_WINDOW_SECONDS,
        )
        enforce_rate_limit(
            "playback:hour:user",
            str(user.pk),
            max_attempts=settings.PLAYBACK_RATE_LIMIT_HOURLY,
            window_seconds=3600,
        )


def _invalider_jetons_actifs(
    *,
    user: User | None,
    ip_prefix: str,
    device_fingerprint: str,
) -> int:
    """Marque consommés les jetons encore valides. Renvoie combien venaient d'un
    *autre* appareil (session unique §4.1.5) — un rafraîchissement du même
    appareil n'incrémente pas `concurrent_play_attempts`.
    """
    maintenant = timezone.now()
    if user is not None:
        actifs = PlaybackToken.objects.select_for_update().filter(
            user=user, consumed=False, expires_at__gt=maintenant
        )
    else:
        # Anonyme : un visiteur, une lecture. On borne par empreinte + préfixe IP
        # pour ne pas couper le voisin du café.
        actifs = PlaybackToken.objects.select_for_update().filter(
            user__isnull=True,
            consumed=False,
            expires_at__gt=maintenant,
            ip_prefix=ip_prefix,
            device_fingerprint=device_fingerprint,
        )
    concurrents = actifs.exclude(device_fingerprint=device_fingerprint).count()
    if device_fingerprint == "":
        # Sans empreinte, on ne peut pas distinguer un refresh d'un second appareil.
        concurrents = actifs.count()
    actifs.update(consumed=True)
    return concurrents


def _verifier_partage(user: User) -> None:
    """Seuils §4.1.6. Jamais de blocage : on pose `flagged_for_review` et on journalise."""
    maintenant = timezone.now()
    depuis_une_heure = maintenant - timedelta(hours=1)
    depuis_sept_jours = maintenant - timedelta(days=7)

    n_jetons = PlaybackToken.objects.filter(user=user, issued_at__gte=depuis_une_heure).count()
    n_ips = (
        PlaybackToken.objects.filter(user=user, issued_at__gte=depuis_une_heure)
        .values("ip_prefix")
        .distinct()
        .count()
    )
    n_empreintes = (
        PlaybackToken.objects.filter(user=user, issued_at__gte=depuis_sept_jours)
        .exclude(device_fingerprint="")
        .values("device_fingerprint")
        .distinct()
        .count()
    )

    raisons: list[str] = []
    if n_jetons > settings.PLAYBACK_FLAG_TOKENS_PER_HOUR:
        raisons.append("tokens_par_heure")
    if n_ips > settings.PLAYBACK_FLAG_IP_PREFIXES_PER_HOUR:
        raisons.append("prefixes_ip_par_heure")
    if n_empreintes > settings.PLAYBACK_FLAG_FINGERPRINTS_7D:
        raisons.append("empreintes_7j")

    if not raisons:
        return
    if user.flagged_for_review:
        return

    user.flagged_for_review = True
    user.save(update_fields=["flagged_for_review"])
    journaliser(
        actor=None,
        action=AuditLog.Action.PLAYBACK_FLAGGED,
        target_type="user",
        target_id=user.pk,
        metadata={
            "raisons": raisons,
            "jetons_heure": n_jetons,
            "ips": n_ips,
            "empreintes": n_empreintes,
        },
    )


def emettre_jeton(
    *,
    lesson_id: int,
    user: User | None,
    client_ip: str,
    ip_prefix: str,
    device_fingerprint: str,
) -> Lecture:
    lecon = _lecon_ou_404(lesson_id)
    if not _a_le_droit(user, lecon):
        raise LectureRefuseeError

    if not lecon.video_provider_id:
        return Lecture(
            disponible=False,
            playback_id=None,
            playback_url=None,
            expires_at=None,
            watermark_label=libelle_filigrane(user),
            resume_at_s=0,
            duration_s=lecon.duration_s,
        )

    if not settings.BUNNY_TOKEN_AUTH_KEY or not settings.BUNNY_CDN_HOSTNAME:
        raise BunnyNonConfigureError

    _plafonner_emission(user, client_ip)

    maintenant = timezone.now()
    expire_a = maintenant + timedelta(seconds=settings.PLAYBACK_TOKEN_TTL_SECONDS)
    empreinte = device_fingerprint[:255]

    # Signer *avant* d'invalider la session en cours : un identifiant vidéo
    # pourri ne doit pas éjecter l'étudiant d'une lecture qui marchait.
    try:
        url = signer_url_lecture(
            cdn_hostname=settings.BUNNY_CDN_HOSTNAME,
            video_id=lecon.video_provider_id,
            token_key=settings.BUNNY_TOKEN_AUTH_KEY,
            expires_ts=int(expire_a.timestamp()),
            client_ip=client_ip,
        )
    except SignatureImpossibleError as exc:
        raise BunnyNonConfigureError from exc

    with transaction.atomic():
        if user is not None:
            User.objects.select_for_update().filter(pk=user.pk).get()
        concurrents = _invalider_jetons_actifs(
            user=user, ip_prefix=ip_prefix, device_fingerprint=empreinte
        )
        if user is not None and concurrents > 0:
            User.objects.filter(pk=user.pk).update(
                concurrent_play_attempts=F("concurrent_play_attempts") + concurrents
            )
            user.refresh_from_db(fields=["concurrent_play_attempts", "flagged_for_review"])

        jeton = PlaybackToken.objects.create(
            user=user,
            lesson=lecon,
            issued_at=maintenant,
            expires_at=expire_a,
            ip_prefix=ip_prefix,
            device_fingerprint=empreinte,
        )

        if user is not None:
            _verifier_partage(user)

        journaliser(
            actor=user,
            action=AuditLog.Action.PLAYBACK_ISSUED,
            target_type="lesson",
            target_id=lecon.pk,
            metadata={
                "playback_id": str(jeton.id),
                "ip_prefix": ip_prefix,
                "concurrent": concurrents > 0,
            },
        )

    reprise = 0
    if user is not None:
        reprise = learning_services.position_de(user, lecon.chapter)

    return Lecture(
        disponible=True,
        playback_id=jeton.id,
        playback_url=url,
        expires_at=expire_a,
        watermark_label=libelle_filigrane(user),
        resume_at_s=reprise,
        duration_s=lecon.duration_s,
    )


def battement(
    *,
    playback_id: UUID,
    user: User | None,
    ip_prefix: str,
    watched_s: int | None,
) -> Battement:
    try:
        jeton = PlaybackToken.objects.select_related("lesson", "lesson__chapter", "user").get(
            pk=playback_id
        )
    except PlaybackToken.DoesNotExist:
        raise JetonInvalideError from None

    if not jeton.est_actif():
        raise JetonInvalideError
    if jeton.ip_prefix != ip_prefix:
        raise JetonInvalideError
    if jeton.user_id is None:
        if user is not None:
            # Un compte connecté ne reprend pas un jeton anonyme.
            raise JetonInvalideError
    elif user is None or jeton.user_id != user.pk:
        raise JetonInvalideError

    reprise = 0
    if user is not None:
        if watched_s is not None:
            reprise = learning_services.enregistrer_position(
                user=user,
                chapter=jeton.lesson.chapter,
                watched_s=watched_s,
                duration_s=jeton.lesson.duration_s,
            )
        else:
            reprise = learning_services.position_de(user, jeton.lesson.chapter)

    return Battement(active=True, expires_at=jeton.expires_at, resume_at_s=reprise)


def lecture_refusee_en_404() -> Http404:
    """404 sans argument : identique à une leçon inexistante (§4.3)."""
    return Http404()

"""Formation → Modules → Chapitres → Leçon (CLAUDE.md §5).

Le domaine métier est « formation », jamais « formation Flutter » en dur (§1) : ces
modèles portent n'importe quelle formation, Flutter + Firebase n'étant que la première
donnée qui y sera semée (`seed_course`).
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone


class Course(models.Model):
    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField()
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["title"]

    def __str__(self) -> str:
        return self.title


class Module(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="modules")
    order = models.PositiveIntegerField()
    title = models.CharField(max_length=200)
    summary = models.TextField(blank=True)

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["course", "order"], name="module_ordre_unique_par_cours"
            )
        ]

    def __str__(self) -> str:
        return f"{self.course.slug} — {self.title}"


class Chapter(models.Model):
    """`is_free` est la seule exception au paywall (§4.4) : jamais un id codé en dur."""

    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="chapters")
    # Unique globalement (pas seulement par module) : c'est l'identifiant de la route
    # publique /gratuit/[chapitre] et de GET /api/public/chapters/{slug}.
    slug = models.SlugField(unique=True)
    order = models.PositiveIntegerField()
    title = models.CharField(max_length=200)
    is_free = models.BooleanField(default=False)

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["module", "order"], name="chapitre_ordre_unique_par_module"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.module} — {self.title}"


class Lesson(models.Model):
    """Le contenu réel. Ne quitte jamais l'API tant que le chapitre n'est pas `is_free`
    ou que l'inscription de l'appelant n'est pas `ACTIVE` (vérifié à l'étape 3+).
    """

    chapter = models.OneToOneField(Chapter, on_delete=models.CASCADE, related_name="lesson")
    video_provider_id = models.CharField(
        max_length=200,
        blank=True,
        help_text="Identifiant Bunny Stream. Vide tant que la vidéo n'est pas déposée (étape 4).",
    )
    duration_s = models.PositiveIntegerField(default=0)
    transcript = models.TextField(blank=True)
    resources = models.JSONField(default=list, blank=True)

    def __str__(self) -> str:
        return f"leçon — {self.chapter}"


class Lead(models.Model):
    """Liste d'attente (§ étape 2). Donnée de contact simple, pas de compte."""

    email = models.EmailField()
    phone = models.CharField(max_length=32, blank=True)
    ip_prefix = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["email"])]

    def __str__(self) -> str:
        return self.email

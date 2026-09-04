"""Purge des preuves de paiement 90 jours après examen (CLAUDE.md §4.5).

Lancée une fois par jour par le service Compose `purge` (Celery beat à l'étape 10) :

    python manage.py purger_preuves

Idempotent : une preuve déjà purgée porte `purged_at` et n'est pas reprise.
"""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand

from apps.enrollment.services import purger_preuves_echues


class Command(BaseCommand):
    help = "Détruit le fichier des preuves de paiement examinées depuis plus de 90 jours."

    def handle(self, *args: Any, **options: Any) -> None:
        purgees = purger_preuves_echues()
        self.stdout.write(f"{purgees} preuve(s) purgée(s).")

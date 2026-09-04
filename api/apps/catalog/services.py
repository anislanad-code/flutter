"""Logique métier du catalogue public (CLAUDE.md §7 : jamais dans les vues)."""

from __future__ import annotations

import time

from django.db import transaction

from apps.catalog.models import Lead

# Un humain qui voit le formulaire, lit les deux champs et les remplit met plus de
# temps que ça. Un bot qui soumet dès le chargement de la page se fait recaler ici.
DELAI_MINIMUM_SOUMISSION_MS = 1500


class SoumissionSuspecteError(Exception):
    """Honeypot rempli ou soumission trop rapide : on ne révèle jamais lequel des deux."""


@transaction.atomic
def creer_lead(*, email: str, phone: str, site: str, form_rendered_at: int, ip_prefix: str) -> Lead:
    if site:
        raise SoumissionSuspecteError
    ecoule_ms = time.time() * 1000 - form_rendered_at
    if ecoule_ms < DELAI_MINIMUM_SOUMISSION_MS:
        raise SoumissionSuspecteError
    return Lead.objects.create(email=email, phone=phone, ip_prefix=ip_prefix)

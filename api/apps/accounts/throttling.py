"""Limitation de débit (§4.2) : compteurs à fenêtre fixe dans le cache Django.

`django.core.cache` avec le backend par défaut (mémoire locale d'un seul processus) est
correct pour le développement, les tests et un déploiement mono-worker. **Limite connue** :
avec plusieurs workers Gunicorn ou plusieurs instances, chaque processus a son propre
compteur — les seuils réels deviennent `seuil * nombre de workers`. À corriger à l'étape 10
(observabilité/prod) en branchant un cache partagé (Redis, déjà prévu pour Celery à
l'étape 9). Documenté ici plutôt que masqué.
"""

from __future__ import annotations

from django.core.cache import cache


class TropDeTentativesError(Exception):
    """Levée quand un seuil de tentatives est dépassé. Traduite en 429 par les vues."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__("Trop de tentatives.")


def enforce_rate_limit(scope: str, key: str, max_attempts: int, window_seconds: int) -> None:
    """Incrémente le compteur `scope:key` ; lève `TropDeTentatives` si le seuil est dépassé."""
    cache_key = f"throttle:{scope}:{key}"
    try:
        count = cache.incr(cache_key)
    except ValueError:
        cache.set(cache_key, 1, timeout=window_seconds)
        count = 1
    if count > max_attempts:
        raise TropDeTentativesError(retry_after=window_seconds)

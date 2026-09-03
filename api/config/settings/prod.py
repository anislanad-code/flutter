"""Réglages de production. Tout ce qui peut être durci l'est. Voir CLAUDE.md §4.6."""

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import env

DEBUG = False

# --- HTTPS et HSTS ---------------------------------------------------------
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31_536_000  # 1 an
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# --- Cookies ---------------------------------------------------------------
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# --- Admin Django : jamais sur le chemin par défaut ------------------------
DJANGO_ADMIN_PATH = env.str("DJANGO_ADMIN_PATH").strip("/ ")
if not DJANGO_ADMIN_PATH or DJANGO_ADMIN_PATH == "admin":
    raise ImproperlyConfigured(
        "DJANGO_ADMIN_PATH doit être renseigné et différent de « admin » en production."
    )

EMAIL_BACKEND = env.str("EMAIL_BACKEND")
DEFAULT_FROM_EMAIL = env.str("DEFAULT_FROM_EMAIL")

"""Réglages de développement. Assouplit le minimum, jamais la liste blanche CORS."""

from .base import *  # noqa: F403
from .base import env

DEBUG = env.bool("DJANGO_DEBUG", default=True)

# Cookies non Secure en local : pas de HTTPS sur localhost. httpOnly et SameSite restent.
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

EMAIL_BACKEND = env.str("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")

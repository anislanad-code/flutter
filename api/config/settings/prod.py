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

# --- Preuves de paiement (§4.5) --------------------------------------------
# Un secret de chiffrement absent ou court signifie des numéros de CCP en clair sur le
# disque : on refuse de démarrer plutôt que de le découvrir après coup.
PAYMENT_PROOF_ENCRYPTION_KEY = env.str("PAYMENT_PROOF_ENCRYPTION_KEY")
CLE_EXEMPLE = "remplace-moi-par-48-octets-aleatoires-en-base64url"
if len(PAYMENT_PROOF_ENCRYPTION_KEY) < 32 or PAYMENT_PROOF_ENCRYPTION_KEY == CLE_EXEMPLE:
    raise ImproperlyConfigured(
        "PAYMENT_PROOF_ENCRYPTION_KEY doit être aléatoire, distincte de l'exemple, "
        "et contenir au moins 32 caractères."
    )

# Le stockage doit être désigné explicitement en production : le défaut de `base.py`
# vit à l'intérieur du code de l'application, ce qui ne survit pas à un redéploiement.
PAYMENT_PROOF_STORAGE_DIR = env.str("PAYMENT_PROOF_STORAGE_DIR")

COURSE_PRICE_DZD = env.int("COURSE_PRICE_DZD")
if COURSE_PRICE_DZD <= 0:
    raise ImproperlyConfigured("COURSE_PRICE_DZD doit être un montant réel en production.")
if not env.str("CCP_ACCOUNT_NUMBER") or not env.str("CCP_ACCOUNT_HOLDER"):
    raise ImproperlyConfigured(
        "Les coordonnées de versement doivent être renseignées en production."
    )

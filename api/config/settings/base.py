"""Réglages communs à tous les environnements.

Ce module ne décide jamais seul d'un choix de sécurité : il pose le socle strict,
`dev.py` assouplit le strict minimum, `prod.py` durcit. Voir CLAUDE.md §4.6.
"""

from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()

# --- Identité et débogage --------------------------------------------------
# Aucune valeur par défaut : une clé absente doit faire échouer le démarrage.
SECRET_KEY: str = env.str("DJANGO_SECRET_KEY")
DEBUG: bool = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS: list[str] = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# Chemin de l'admin Django. En production, prod.py exige une valeur explicite (§4.6).
# Une valeur vide — la forme d'une ligne `.env` laissée en blanc — monterait l'admin
# à la racine du site : on refuse de démarrer plutôt que de l'exposer.
DJANGO_ADMIN_PATH: str = env.str("DJANGO_ADMIN_PATH", default="admin").strip("/ ")
if not DJANGO_ADMIN_PATH:
    raise ImproperlyConfigured("DJANGO_ADMIN_PATH ne peut pas être vide.")

# --- Applications ----------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "corsheaders",
]

LOCAL_APPS = [
    "apps.accounts",
    "apps.enrollment",
    "apps.catalog",
    "apps.learning",
    "apps.assessment",
    "apps.media",
    "apps.certification",
    "apps.audit",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.enrollment.middleware.PlafondPreuveMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Base de données -------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env.str("POSTGRES_DB"),
        "USER": env.str("POSTGRES_USER"),
        "PASSWORD": env.str("POSTGRES_PASSWORD"),
        "HOST": env.str("POSTGRES_HOST", default="db"),
        "PORT": env.int("POSTGRES_PORT", default=5432),
        "CONN_MAX_AGE": 60,
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"

# --- Mots de passe (CLAUDE.md §4.2) ----------------------------------------
# Argon2id en tête. PBKDF2 reste présent uniquement pour relire d'anciens hachages.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- DRF : deny by default (CLAUDE.md §4.3) --------------------------------
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.CookieAccessTokenAuthentication"
    ],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
}

# --- Authentification (CLAUDE.md §4.2) --------------------------------------
# Access court, refresh rotatif. Valeurs figées en code : ce ne sont pas des choix de
# déploiement, mais des décisions de sécurité qui ne doivent pas varier entre environnements.
ACCESS_TOKEN_TTL_SECONDS = 15 * 60
REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
PASSWORD_RESET_TOKEN_TTL_SECONDS = 30 * 60

# URL publique du site Next, utilisée pour construire les liens envoyés par email.
SITE_URL: str = env.str("SITE_URL", default="http://localhost:3000")

# --- Preuves de paiement (CLAUDE.md §4.5) ----------------------------------
# Répertoire privé, hors racine web : aucune route statique de Django ni de Next ne
# pointe dessus. Le seul chemin de lecture est /api/admin/proofs/{id}/file, qui exige
# une session admin *et* une signature de 10 minutes.
PAYMENT_PROOF_STORAGE_DIR: str = env.str(
    "PAYMENT_PROOF_STORAGE_DIR", default=str(BASE_DIR / ".preuves-privees")
)
# Secret de chiffrement au repos. Aucune valeur par défaut utilisable : `storage.py`
# refuse un secret de moins de 32 caractères plutôt que de chiffrer avec de la paille.
PAYMENT_PROOF_ENCRYPTION_KEY: str = env.str("PAYMENT_PROOF_ENCRYPTION_KEY", default="")

# Taille maximale d'un corps non-fichier, et seuil au-delà duquel un fichier téléversé
# passe sur disque au lieu de rester en mémoire. La limite de 5 Mo du §4.5, elle, est
# appliquée dans apps/enrollment/files.py — ceci ne fait que borner le coût du refus.
DATA_UPLOAD_MAX_MEMORY_SIZE = 1 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 100

# --- Lecture vidéo Bunny Stream (CLAUDE.md §4.1) -----------------------------
# L'identifiant de bibliothèque n'est pas un secret ; la clé de signature l'est.
# Vides en développement tant qu'aucune vidéo n'est déposée : l'émission d'un
# jeton refuse alors poliment, sans jamais inventer une URL.
BUNNY_LIBRARY_ID: str = env.str("BUNNY_LIBRARY_ID", default="")
BUNNY_API_KEY: str = env.str("BUNNY_API_KEY", default="")
BUNNY_TOKEN_AUTH_KEY: str = env.str("BUNNY_TOKEN_AUTH_KEY", default="")
BUNNY_CDN_HOSTNAME: str = env.str("BUNNY_CDN_HOSTNAME", default="")
# TTL figé : un jeton de lecture ne vit pas plus de 5 minutes (§4.1.2).
PLAYBACK_TOKEN_TTL_SECONDS = 5 * 60
# Limites d'émission. Les seuils de *détection* de partage (§4.1.6) sont plus
# bas que le rate limit : on flague avant de couper l'émission.
PLAYBACK_RATE_LIMIT_BURST = 12
PLAYBACK_RATE_LIMIT_BURST_WINDOW_SECONDS = 60
PLAYBACK_RATE_LIMIT_HOURLY = 80
PLAYBACK_FLAG_TOKENS_PER_HOUR = 40
PLAYBACK_FLAG_IP_PREFIXES_PER_HOUR = 2
PLAYBACK_FLAG_FINGERPRINTS_7D = 3

# --- Versement CCP (CLAUDE.md §2 : manuel d'abord, Chargily à l'étape 11) ---
# Coordonnées destinées à être affichées : ce ne sont pas des secrets, mais ce sont
# des données de déploiement — jamais en dur dans le code.
COURSE_PRICE_DZD: int = env.int("COURSE_PRICE_DZD", default=0)
CCP_ACCOUNT_NUMBER: str = env.str("CCP_ACCOUNT_NUMBER", default="")
CCP_ACCOUNT_KEY: str = env.str("CCP_ACCOUNT_KEY", default="")
CCP_ACCOUNT_HOLDER: str = env.str("CCP_ACCOUNT_HOLDER", default="")

# --- Cache : compteurs de limitation de débit (§4.2) ------------------------
# Backend mémoire locale par défaut : correct en dev/tests/mono-worker. Voir la limite
# documentée dans apps/accounts/throttling.py pour un déploiement multi-worker.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# --- CORS : liste blanche, jamais "*" (CLAUDE.md §4.6) ---------------------
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS: list[str] = env.list("DJANGO_CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS: list[str] = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

# --- Cookies (CLAUDE.md §4.2) ----------------------------------------------
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Strict"

# --- En-têtes de sécurité --------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

# --- Internationalisation --------------------------------------------------
LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Africa/Algiers"
USE_I18N = True
USE_TZ = True

# --- Fichiers statiques ----------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Journalisation --------------------------------------------------------
# Les journaux ne contiennent jamais mots de passe, tokens, cookies ni URLs signées.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "redact_secrets": {"()": "config.logging_filters.RedactSecretsFilter"},
    },
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "standard",
            "filters": ["redact_secrets"],
        },
    },
    "loggers": {
        # `runserver` / gunicorn écrivent la ligne de requête ici : c'est par ce
        # canal qu'une signature en query string fuirait (§4.6).
        "django.server": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}

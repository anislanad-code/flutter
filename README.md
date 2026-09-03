# anis.dev — plateforme de formation

Formations tech en français, pour le marché algérien. Première formation :
Flutter + Firebase pour débutants absolus.

- `CLAUDE.md` — la constitution du projet. À lire avant de toucher au code.
- `progress.md` — le plan d'exécution, étape par étape.
- `api/` — Django 5 + DRF.
- `web/` — Next.js 15 (App Router). Seul client de l'API.

Le navigateur ne parle jamais directement à Django : il appelle les Route Handlers
de Next, qui appellent l'API côté serveur.

## Démarrer depuis un clone vierge

Il faut Docker et Docker Compose. Rien d'autre.

```bash
cp .env.example .env
# Génère une vraie clé pour DJANGO_SECRET_KEY :
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
# Colle-la dans .env, puis :
docker compose up --build
```

- Site : http://localhost:3000
- Santé, vue du navigateur : http://localhost:3000/api/health → `{"status":"ok","api":"ok","db":"ok"}`
- Santé, vue directe de Django (débogage seulement) : http://localhost:8000/api/health

Ouvre l'onglet réseau sur http://localhost:3000 : aucune requête ne doit partir vers
le port 8000. Si une seule y va, c'est un bug, pas un détail.

## Travailler sans Docker

**API** — Python 3.12 minimum, et un PostgreSQL joignable.

```bash
cd api
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
set -a && source ../.env && set +a
export POSTGRES_HOST=localhost
python manage.py migrate
python manage.py runserver
```

**Web** — Node 22 minimum.

```bash
cd web
npm ci
API_INTERNAL_URL=http://localhost:8000 npm run dev
```

## Contrôles à passer avant de pousser

```bash
# API
cd api && ruff check . && ruff format --check . && mypy apps config && pytest --cov=apps --cov=config

# Web
cd web && npm run lint && npm run typecheck && npm run test && npm run build
```

La CI GitHub Actions rejoue exactement ces commandes, plus une vérification qu'aucun
secret n'est commité.

## Secrets

`.env` est dans `.gitignore` depuis le premier commit et n'y entre jamais.
`.env.example` liste toutes les variables avec des valeurs factices.

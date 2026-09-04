FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libpq pour psycopg, build-essential pour argon2-cffi,
# libmagic1 pour python-magic (détection du type réel par magic bytes, §4.5)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential libpq-dev curl libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Les dépendances d'abord : la couche est réutilisée tant que pyproject ne bouge pas.
COPY pyproject.toml ./
RUN mkdir -p config/settings apps \
    && touch config/__init__.py config/settings/__init__.py apps/__init__.py \
    && pip install --no-cache-dir -e ".[dev]"

COPY . .

# Utilisateur non root
RUN useradd --create-home --uid 1000 app && chown -R app:app /app
USER app

EXPOSE 8000

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

"""Points d'entrée WSGI/ASGI : ils ne sont jamais importés par les tests métier,
donc une erreur dedans ne se voit qu'en production. On les charge ici."""

import importlib
import os
from typing import Any


def test_wsgi_expose_une_application() -> None:
    module = importlib.import_module("config.wsgi")

    application: Any = module.application
    assert callable(application)


def test_asgi_expose_une_application() -> None:
    module = importlib.import_module("config.asgi")

    application: Any = module.application
    assert callable(application)


def test_les_entrypoints_ne_codent_aucun_reglage_en_dur() -> None:
    """Le module de settings vient de l'environnement, pas d'une valeur figée sur `prod`."""
    importlib.import_module("config.wsgi")

    assert os.environ["DJANGO_SETTINGS_MODULE"].startswith("config.settings.")

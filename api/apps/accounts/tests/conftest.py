from collections.abc import Iterator
from typing import cast

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User


@pytest.fixture(autouse=True)
def _cache_videe() -> Iterator[None]:
    """Les compteurs de limitation de débit vivent dans le cache, pas la base : sans ce
    nettoyage, les tests se contamineraient les uns les autres (même email, même IP de test).
    """
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def mot_de_passe() -> str:
    return "un-mot-de-passe-solide-123"


@pytest.fixture
def utilisateur(db: None, mot_de_passe: str) -> User:
    return cast(
        User,
        User.objects.create_user(
            email="etudiante@example.com", phone="0555000000", password=mot_de_passe
        ),
    )

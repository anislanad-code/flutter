"""Fixtures partagées par toute la suite."""

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client() -> APIClient:
    """Client HTTP non authentifié."""
    return APIClient()

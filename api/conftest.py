"""Fixtures racine : valables pour `tests/` et `apps/*/tests/`."""

from __future__ import annotations

import pytest
from pytest_django.fixtures import SettingsWrapper


@pytest.fixture(autouse=True)
def _emails_en_memoire(settings: SettingsWrapper) -> None:
    """Les tests lisent `mail.outbox` : le backend console (même rédigé) ne le remplit pas."""
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

"""Écriture du journal d'audit. Point d'entrée unique (CLAUDE.md §7 : hors des vues)."""

from __future__ import annotations

import uuid
from typing import Any

from apps.accounts.models import User
from apps.audit.models import AuditLog


def journaliser(
    *,
    actor: User | None,
    action: str,
    target_type: str,
    target_id: str | int | uuid.UUID,
    metadata: dict[str, Any] | None = None,
) -> AuditLog:
    """Écrit une entrée immuable.

    L'appelant est responsable de ne passer dans `metadata` que des données non
    sensibles : jamais d'URL signée, de token ni de contenu de preuve (§4.6).
    """
    return AuditLog.objects.create(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        metadata=metadata or {},
    )

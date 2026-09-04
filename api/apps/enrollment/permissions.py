"""Autorisation des routes d'administration (CLAUDE.md §4.3).

Un compte authentifié mais non-admin reçoit **404**, pas 403 : confirmer l'existence
d'une route d'administration à un étudiant curieux n'apporte rien et lui indique où
insister. Un visiteur non authentifié reçoit 401, pour que le BFF sache qu'il doit
rafraîchir la session plutôt que d'afficher une page vide.

`is_staff` ne vient jamais d'un payload : il est lu sur l'objet `User` chargé depuis la
base par l'authentification par cookie.
"""

from __future__ import annotations

from typing import Any

from django.http import Http404
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView


class EstAdmin(BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        user: Any = request.user
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        if not getattr(user, "is_staff", False):
            raise Http404
        return True

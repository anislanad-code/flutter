"""Plafond de taille sur le dépôt de preuve, avant parsing multipart (CLAUDE.md §4.5)."""

from __future__ import annotations

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse, JsonResponse

from apps.enrollment.files import TAILLE_MAX_OCTETS

# Marge pour l'enveloppe multipart (frontières, champ montant).
MARGE_MULTIPART = 8192
PLAFOND = TAILLE_MAX_OCTETS + MARGE_MULTIPART


class PlafondPreuveMiddleware:
    """Un `Content-Length` trop grand ne doit même pas atteindre la vue.

    Ce n'est pas un substitut d'un `client_max_body_size` de reverse-proxy (étape 10),
    mais ça rend le 413 honnête dès que le client déclare sa taille.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if request.path.rstrip("/") == "/api/enrollment/proof" and request.method == "POST":
            declaree = request.META.get("CONTENT_LENGTH") or ""
            if declaree.isdigit() and int(declaree) > PLAFOND:
                return JsonResponse({"detail": "Le fichier dépasse 5 Mo."}, status=413)
        return self.get_response(request)

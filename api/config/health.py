"""Sonde de santé. Infrastructure, pas métier : elle n'a pas sa place dans une app."""

from django.db import DatabaseError, connection
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """`GET /api/health` — état du service et de sa base."""

    # Endpoint public : l'exception à `IsAuthenticated` est déclarée explicitement (§4.3).
    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def get(self, request: Request) -> Response:
        db_status = "ok"
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except DatabaseError:
            db_status = "down"

        # Le corps doit dire la même chose que le code HTTP : annoncer « ok » avec un
        # 503 obligeait chaque appelant à ne lire que le statut de la réponse.
        healthy = db_status == "ok"
        return Response(
            {"status": "ok" if healthy else "degraded", "db": db_status},
            status=200 if healthy else 503,
        )

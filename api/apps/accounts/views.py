"""Vues d'authentification. La logique vit dans `services.py` (CLAUDE.md §7)."""

from __future__ import annotations

from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import services
from apps.accounts.models import User
from apps.accounts.serializers import (
    LoginSerializer,
    LogoutSerializer,
    MeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RefreshSerializer,
    RegisterSerializer,
)
from apps.accounts.throttling import TropDeTentativesError, enforce_rate_limit
from apps.accounts.utils import get_client_ip
from apps.accounts.utils import ip_prefix as compute_ip_prefix

MESSAGE_IDENTIFIANTS_INVALIDES = "Email ou mot de passe incorrect."
MESSAGE_RESET_GENERIQUE = (
    "Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé."
)


def _session_response(emise: services.SessionEmise, *, status_code: int = 200) -> Response:
    return Response(
        {
            "access_token": emise.access_token,
            "access_token_expires_in": emise.access_ttl,
            "refresh_token": emise.refresh_token,
            "refresh_token_expires_in": emise.refresh_ttl,
            "user": MeSerializer(emise.user).data,
        },
        status=status_code,
    )


def _device_fingerprint(request: Request) -> str:
    empreinte: str = request.META.get("HTTP_X_DEVICE_FINGERPRINT", "")
    agent: str = request.META.get("HTTP_USER_AGENT", "")
    return empreinte or agent


class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ip = get_client_ip(request)
        try:
            enforce_rate_limit("register:ip", ip, max_attempts=20, window_seconds=900)
        except TropDeTentativesError:
            return Response({"detail": "Trop de tentatives. Réessaie plus tard."}, status=429)

        try:
            services.enregistrer(
                email=data["email"], phone=data.get("phone", ""), password=data["password"]
            )
        except services.MotDePasseInvalideError as exc:
            return Response({"password": exc.erreurs}, status=400)

        # Jamais de connexion automatique ici : une réponse qui varie selon que le
        # compte vient d'être créé ou existait déjà (avec ou sans tokens, avec ou sans
        # Set-Cookie) est un oracle d'énumération à elle seule, même à statut et corps
        # identiques (§4.2 — constaté ÉLEVÉ par la porte de sécurité de l'étape 1). Le
        # BFF (web/app/api/auth/register) enchaîne un vrai `POST /api/auth/login` côté
        # client avec les mêmes identifiants : cette étape suivante est déjà auditée
        # pour ne rien révéler (message et timing identiques compte connu/inconnu).
        return Response(
            {"detail": "Compte créé si l'email était disponible. Connecte-toi pour continuer."},
            status=201,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ip = get_client_ip(request)
        email_key = data["email"].strip().lower()
        try:
            enforce_rate_limit("login:account", email_key, max_attempts=5, window_seconds=900)
            enforce_rate_limit("login:ip", ip, max_attempts=20, window_seconds=900)
        except TropDeTentativesError:
            return Response({"detail": "Trop de tentatives. Réessaie plus tard."}, status=429)

        try:
            emise = services.connecter(
                email=data["email"],
                password=data["password"],
                device_fingerprint=_device_fingerprint(request),
                ip_prefix=compute_ip_prefix(ip),
            )
        except services.IdentifiantsInvalidesError:
            return Response({"detail": MESSAGE_IDENTIFIANTS_INVALIDES}, status=401)

        return _session_response(emise)


class RefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request: Request) -> Response:
        serializer = RefreshSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        ip = get_client_ip(request)
        try:
            enforce_rate_limit("refresh:ip", ip, max_attempts=30, window_seconds=900)
        except TropDeTentativesError:
            return Response({"detail": "Trop de tentatives. Réessaie plus tard."}, status=429)

        try:
            emise = services.rafraichir(
                refresh_cookie=serializer.validated_data["refresh_token"],
                device_fingerprint=_device_fingerprint(request),
                ip_prefix=compute_ip_prefix(ip),
            )
        except services.JetonInvalideError:
            return Response({"detail": "Session invalide ou expirée."}, status=401)

        return _session_response(emise)


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request: Request) -> Response:
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.deconnecter(refresh_cookie=serializer.validated_data.get("refresh_token") or None)
        return Response(status=204)


class LogoutAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        # `IsAuthenticated` garantit que `request.user` est un `User` authentifié, jamais
        # `AnonymousUser` : le typage statique de DRF ne le sait pas.
        assert isinstance(request.user, User)
        services.deconnecter_partout(user=request.user)
        return Response(status=204)


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request: Request) -> Response:
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        ip = get_client_ip(request)
        email_key = serializer.validated_data["email"].strip().lower()
        try:
            enforce_rate_limit("reset:account", email_key, max_attempts=3, window_seconds=3600)
            enforce_rate_limit("reset:ip", ip, max_attempts=10, window_seconds=3600)
        except TropDeTentativesError:
            # Même en cas de dépassement, on ne confirme ni n'infirme l'existence du compte.
            return Response({"detail": MESSAGE_RESET_GENERIQUE}, status=200)

        services.demander_reinitialisation(email=serializer.validated_data["email"])
        return Response({"detail": MESSAGE_RESET_GENERIQUE}, status=200)


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list[type[BaseAuthentication]] = []

    def post(self, request: Request) -> Response:
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ip = get_client_ip(request)
        try:
            enforce_rate_limit("reset-confirm:ip", ip, max_attempts=20, window_seconds=900)
        except TropDeTentativesError:
            return Response({"detail": "Trop de tentatives. Réessaie plus tard."}, status=429)

        try:
            services.confirmer_reinitialisation(token=data["token"], password=data["password"])
        except services.JetonInvalideError:
            return Response({"detail": "Ce lien n'est plus valable."}, status=400)
        except services.MotDePasseInvalideError as exc:
            return Response({"password": exc.erreurs}, status=400)

        return Response(status=204)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response(MeSerializer(request.user).data)

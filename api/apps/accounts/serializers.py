"""Serializers explicites, champ par champ (CLAUDE.md §7 — jamais `fields = '__all__'`)."""

from __future__ import annotations

from rest_framework import serializers

from apps.accounts.models import User


class RegisterSerializer(serializers.Serializer):  # type: ignore[type-arg]
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=32, allow_blank=True, required=False, default="")
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class LoginSerializer(serializers.Serializer):  # type: ignore[type-arg]
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class RefreshSerializer(serializers.Serializer):  # type: ignore[type-arg]
    refresh_token = serializers.CharField()


class LogoutSerializer(serializers.Serializer):  # type: ignore[type-arg]
    refresh_token = serializers.CharField(required=False, allow_blank=True, default="")


class PasswordResetRequestSerializer(serializers.Serializer):  # type: ignore[type-arg]
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):  # type: ignore[type-arg]
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class MeSerializer(serializers.ModelSerializer[User]):
    """`flagged_for_review` est délibérément absent : c'est un signal interne à l'admin
    (§4.1.6 — jamais de blocage automatique, juste une remontée). Le révéler au compte
    signalé lui-même l'aiderait à ajuster son comportement pour passer sous les seuils.
    """

    class Meta:
        model = User
        fields = ["id", "email", "phone", "is_staff", "created_at", "last_activity_at"]
        read_only_fields = fields

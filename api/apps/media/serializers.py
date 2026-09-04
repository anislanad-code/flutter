"""Serializers de lecture. Aucune URL de média n'est construite ici (§4.1.1)."""

from __future__ import annotations

from rest_framework import serializers


class PlaybackRequestSerializer(serializers.Serializer):  # type: ignore[type-arg]
    """Corps optionnel. Tout champ surnuméraire (is_staff, role, …) est ignoré."""

    pass


class HeartbeatRequestSerializer(serializers.Serializer):  # type: ignore[type-arg]
    watched_s = serializers.IntegerField(required=False, min_value=0, max_value=86_400)


class PlaybackResponseSerializer(serializers.Serializer):  # type: ignore[type-arg]
    disponible = serializers.BooleanField()
    playback_id = serializers.UUIDField(allow_null=True)
    playback_url = serializers.CharField(allow_null=True, allow_blank=True)
    expires_at = serializers.DateTimeField(allow_null=True)
    watermark_label = serializers.CharField()
    resume_at_s = serializers.IntegerField()
    duration_s = serializers.IntegerField()


class HeartbeatResponseSerializer(serializers.Serializer):  # type: ignore[type-arg]
    active = serializers.BooleanField()
    expires_at = serializers.DateTimeField()
    resume_at_s = serializers.IntegerField()

"""Serializers explicites (CLAUDE.md §7 — jamais `fields = '__all__'`).

Aucun serializer d'entrée n'expose `status`, `enrollment_status`, `reviewed_by` ni quoi
que ce soit qui décide d'un droit : ces champs ne viennent jamais du client (§4.3). Les
serializers d'entrée sont des `Serializer` nus, pas des `ModelSerializer` — il n'existe
donc aucun chemin par lequel un champ du modèle serait affecté par la requête.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.enrollment.files import TAILLE_MAX_OCTETS
from apps.enrollment.models import Enrollment, PaymentProof
from apps.enrollment.providers import reference_versement
from apps.enrollment.services import EtatInscription

MONTANT_MAX_DZD = 1_000_000


class ProofUploadSerializer(serializers.Serializer):  # type: ignore[type-arg]
    file = serializers.FileField()
    amount_declared = serializers.IntegerField(min_value=1, max_value=MONTANT_MAX_DZD)

    def validate_file(self, value: object) -> object:
        # Premier filet : la taille réelle est revérifiée sur le contenu lu, parce que
        # `size` vient de l'en-tête de la partie multipart et n'engage que le client.
        taille = getattr(value, "size", 0) or 0
        if taille > TAILLE_MAX_OCTETS:
            raise serializers.ValidationError("Le fichier dépasse 5 Mo.")
        return value


class RejectSerializer(serializers.Serializer):  # type: ignore[type-arg]
    """Le motif est obligatoire : un refus sans explication est un cul-de-sac pour l'étudiant."""

    reason = serializers.CharField(max_length=500, allow_blank=False, trim_whitespace=True)


class AcceptSerializer(serializers.Serializer):  # type: ignore[type-arg]
    note = serializers.CharField(
        max_length=500, allow_blank=True, required=False, default="", trim_whitespace=True
    )


class InstructionsSerializer(serializers.Serializer):  # type: ignore[type-arg]
    """Sortie seulement. Construit depuis la dataclasse du fournisseur, pas depuis un modèle."""

    provider = serializers.CharField(read_only=True)
    requiert_preuve = serializers.BooleanField(read_only=True)
    amount_dzd = serializers.IntegerField(read_only=True)
    account_label = serializers.CharField(read_only=True)
    account_number = serializers.CharField(read_only=True)
    account_key = serializers.CharField(read_only=True)
    account_holder = serializers.CharField(read_only=True)
    reference = serializers.CharField(read_only=True)


class PreuveEtudiantSerializer(serializers.ModelSerializer[PaymentProof]):
    """Ce que l'étudiant voit de sa propre preuve.

    Ni `file_key` ni `content_type` : la clé de stockage n'a aucune raison d'atteindre
    un navigateur, et elle est le seul élément qui désigne l'objet chiffré (§4.5).
    """

    class Meta:
        model = PaymentProof
        fields = ["id", "status", "amount_declared", "reject_reason", "created_at", "reviewed_at"]
        read_only_fields = fields


class EnrollmentStatusSerializer(serializers.Serializer):  # type: ignore[type-arg]
    status = serializers.SerializerMethodField()
    course_slug = serializers.SerializerMethodField()
    depot_possible = serializers.BooleanField(read_only=True)
    instructions = InstructionsSerializer(read_only=True)
    derniere_preuve = PreuveEtudiantSerializer(read_only=True)

    def get_status(self, obj: EtatInscription) -> str:
        return str(obj.enrollment.status)

    def get_course_slug(self, obj: EtatInscription) -> str | None:
        cours = obj.enrollment.course
        return cours.slug if cours is not None else None


class AdminPreuveSerializer(serializers.ModelSerializer[PaymentProof]):
    """Vue admin d'une preuve. `file_key` reste absent ici aussi : l'admin obtient le
    fichier par une URL signée à durée de vie courte, jamais par la clé de stockage."""

    class Meta:
        model = PaymentProof
        fields = [
            "id",
            "status",
            "amount_declared",
            "content_type",
            "byte_size",
            "reject_reason",
            "created_at",
            "reviewed_at",
            "purged_at",
        ]
        read_only_fields = fields


class AdminEnrollmentSerializer(serializers.ModelSerializer[Enrollment]):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_phone = serializers.CharField(source="user.phone", read_only=True)
    course_title = serializers.SerializerMethodField()
    reference = serializers.SerializerMethodField()
    preuves = AdminPreuveSerializer(source="payment_proofs", many=True, read_only=True)

    class Meta:
        model = Enrollment
        fields = [
            "id",
            "status",
            "user_email",
            "user_phone",
            "course_title",
            "reference",
            "note_admin",
            "created_at",
            "activated_at",
            "preuves",
        ]
        read_only_fields = fields

    def get_course_title(self, obj: Enrollment) -> str | None:
        cours = obj.course
        return cours.title if cours is not None else None

    def get_reference(self, obj: Enrollment) -> str:
        return reference_versement(obj.pk)


class ProofUrlSerializer(serializers.Serializer):  # type: ignore[type-arg]
    """Le BFF consomme `expires` et `signature` comme en-têtes, jamais le navigateur."""

    path = serializers.CharField(read_only=True)
    expires = serializers.IntegerField(read_only=True)
    signature = serializers.CharField(read_only=True)
    expires_in = serializers.IntegerField(read_only=True)

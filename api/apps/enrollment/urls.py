"""Routes de l'inscription payante.

`proof_id` est déclaré `<uuid:...>` : un identifiant mal formé n'atteint jamais la vue.
"""

from __future__ import annotations

from django.urls import path

from apps.enrollment.views import (
    AdminEnrollmentAcceptView,
    AdminEnrollmentListView,
    AdminEnrollmentRejectView,
    AdminProofFileView,
    AdminProofUrlView,
    EnrollmentStatusView,
    PaymentProofUploadView,
)

urlpatterns = [
    # Étudiant : aucune de ces routes ne prend d'identifiant.
    path("enrollment/status", EnrollmentStatusView.as_view(), name="enrollment-status"),
    path("enrollment/proof", PaymentProofUploadView.as_view(), name="enrollment-proof"),
    # Admin.
    path("admin/enrollments", AdminEnrollmentListView.as_view(), name="admin-enrollments"),
    path(
        "admin/enrollments/<int:enrollment_id>/accept",
        AdminEnrollmentAcceptView.as_view(),
        name="admin-enrollment-accept",
    ),
    path(
        "admin/enrollments/<int:enrollment_id>/reject",
        AdminEnrollmentRejectView.as_view(),
        name="admin-enrollment-reject",
    ),
    path(
        "admin/proofs/<uuid:proof_id>/url",
        AdminProofUrlView.as_view(),
        name="admin-proof-url",
    ),
    path(
        "admin/proofs/<uuid:proof_id>/file",
        AdminProofFileView.as_view(),
        name="admin-proof-file",
    ),
]

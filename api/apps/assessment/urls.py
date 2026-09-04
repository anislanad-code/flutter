"""Routes des QCM et examens. Aucune ne prend d'identifiant d'un autre utilisateur."""

from __future__ import annotations

from django.urls import path

from apps.assessment.views import AttemptSubmitView, QuizDetailView, QuizStartAttemptView

urlpatterns = [
    path("quizzes/<int:id>", QuizDetailView.as_view(), name="quiz-detail"),
    path("quizzes/<int:id>/attempts", QuizStartAttemptView.as_view(), name="quiz-start-attempt"),
    path("attempts/<int:id>/submit", AttemptSubmitView.as_view(), name="attempt-submit"),
]

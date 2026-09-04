"""Backend console qui n'écrit jamais un jeton ou une signature en clair (§4.6)."""

from __future__ import annotations

from django.core.mail.backends.console import EmailBackend as ConsoleEmailBackend
from django.core.mail.message import EmailMessage

from config.logging_filters import rediger_secrets


class RedactingConsoleEmailBackend(ConsoleEmailBackend):
    """En développement, Django imprime les emails sur stdout.

    Sans ce masque, un `password-reset` dépose le jeton brut dans `docker compose logs`,
    mélangé aux access logs — exactement ce que §4.6 interdit, et ce que la porte de
    l'étape 3 a exploité.
    """

    def write_message(self, message: EmailMessage) -> None:
        mime = message.message()
        decoded = mime.as_bytes().decode("utf-8", errors="replace")
        self.stream.write(rediger_secrets(decoded))
        self.stream.write("\n")
        self.stream.write("-" * 79)
        self.stream.write("\n")
        self.stream.flush()

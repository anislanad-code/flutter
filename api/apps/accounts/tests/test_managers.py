"""`UserManager` : l'email est l'identifiant, et il est obligatoire."""

import pytest

from apps.accounts.models import User


@pytest.mark.django_db
def test_create_user_normalise_et_minuscule_l_email() -> None:
    utilisateur = User.objects.create_user(
        email="  MAJUSCULE@Example.COM  ".strip(), password="un-mot-de-passe-solide-1"
    )

    assert utilisateur.email == "majuscule@example.com"
    assert utilisateur.is_staff is False
    assert utilisateur.is_superuser is False


@pytest.mark.django_db
def test_create_user_hache_le_mot_de_passe_avec_argon2() -> None:
    utilisateur = User.objects.create_user(
        email="argon@example.com", password="un-mot-de-passe-solide-1"
    )

    assert utilisateur.password.startswith("argon2$")
    assert "un-mot-de-passe-solide-1" not in utilisateur.password
    assert utilisateur.check_password("un-mot-de-passe-solide-1")


@pytest.mark.django_db
def test_create_user_sans_email_leve_une_erreur() -> None:
    with pytest.raises(ValueError, match="email"):
        User.objects.create_user(email="", password="un-mot-de-passe-solide-1")


@pytest.mark.django_db
def test_create_user_sans_mot_de_passe_donne_un_compte_inutilisable() -> None:
    """Cas limite : `password=None` → hachage impossible à satisfaire, pas de mot de passe vide."""
    utilisateur = User.objects.create_user(email="sans-mdp@example.com")

    assert utilisateur.has_usable_password() is False
    assert utilisateur.check_password("") is False


@pytest.mark.django_db
def test_create_superuser_donne_bien_is_staff_et_is_superuser() -> None:
    admin = User.objects.create_superuser(email="anis@example.com", password="mot-de-passe-admin-1")

    assert admin.is_staff is True
    assert admin.is_superuser is True


@pytest.mark.django_db
def test_create_superuser_refuse_is_staff_false() -> None:
    with pytest.raises(ValueError, match="is_staff"):
        User.objects.create_superuser(
            email="faux-admin@example.com", password="mot-de-passe-admin-1", is_staff=False
        )


@pytest.mark.django_db
def test_create_superuser_refuse_is_superuser_false() -> None:
    with pytest.raises(ValueError, match="is_superuser"):
        User.objects.create_superuser(
            email="faux-admin@example.com", password="mot-de-passe-admin-1", is_superuser=False
        )

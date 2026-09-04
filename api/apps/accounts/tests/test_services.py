"""Services d'authentification : transitions d'état, idempotence, atomicité (§7)."""

import uuid
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts import services
from apps.accounts.models import PasswordResetToken, Session, User
from apps.accounts.tokens import hash_secret
from apps.enrollment.models import Enrollment


@pytest.mark.django_db
def test_enregistrer_cree_compte_et_enrollment_dans_la_meme_transaction() -> None:
    services.enregistrer(
        email="  NOUVELLE@Example.com ", phone="0555000001", password="un-mot-de-passe-solide-1"
    )

    utilisateur = User.objects.get(email="nouvelle@example.com")
    assert utilisateur.phone == "0555000001"
    assert Enrollment.objects.get(user=utilisateur).status == Enrollment.Status.PENDING


@pytest.mark.django_db
def test_enregistrer_avec_un_mot_de_passe_invalide_ne_laisse_aucun_effet_partiel() -> None:
    """Atomicité : ni User, ni Enrollment, ni email de bienvenue."""
    with pytest.raises(services.MotDePasseInvalideError) as info:
        services.enregistrer(email="faible@example.com", phone="", password="court")

    assert info.value.erreurs
    assert User.objects.filter(email="faible@example.com").exists() is False
    assert Enrollment.objects.count() == 0
    assert mail.outbox == []


@pytest.mark.django_db
def test_enregistrer_refuse_un_mot_de_passe_courant() -> None:
    with pytest.raises(services.MotDePasseInvalideError):
        services.enregistrer(email="commun@example.com", phone="", password="motdepasse")


@pytest.mark.django_db
def test_enregistrer_deux_fois_le_meme_email_ne_cree_ni_doublon_ni_second_enrollment(
    utilisateur: User,
) -> None:
    services.enregistrer(email=utilisateur.email, phone="0000", password="un-autre-mot-de-passe-1")

    assert User.objects.filter(email=utilisateur.email).count() == 1
    assert Enrollment.objects.filter(user=utilisateur).count() == 0
    # Le mot de passe existant n'a surtout pas été écrasé par celui de l'appelant.
    utilisateur.refresh_from_db()
    assert utilisateur.check_password("un-autre-mot-de-passe-1") is False


@pytest.mark.django_db
def test_connecter_avec_un_compte_desactive_echoue_comme_un_mauvais_mot_de_passe(
    utilisateur: User, mot_de_passe: str
) -> None:
    utilisateur.is_active = False
    utilisateur.save(update_fields=["is_active"])

    with pytest.raises(services.IdentifiantsInvalidesError):
        services.connecter(
            email=utilisateur.email,
            password=mot_de_passe,
            device_fingerprint="test",
            ip_prefix="41.100.5",
        )


@pytest.mark.django_db
def test_connecter_tronque_une_empreinte_d_appareil_demesuree(
    utilisateur: User, mot_de_passe: str
) -> None:
    """Cas limite : un `User-Agent` de 10 000 caractères ne doit pas faire échouer l'insertion."""
    emise = services.connecter(
        email=utilisateur.email,
        password=mot_de_passe,
        device_fingerprint="A" * 10_000,
        ip_prefix="41.100.5",
    )

    session = Session.objects.get(user=utilisateur)
    assert len(session.device_fingerprint) == 255
    assert emise.user == utilisateur


@pytest.mark.django_db
def test_deconnecter_est_idempotent_et_tolere_un_cookie_absent_ou_absurde(
    utilisateur: User, mot_de_passe: str
) -> None:
    emise = services.connecter(
        email=utilisateur.email,
        password=mot_de_passe,
        device_fingerprint="test",
        ip_prefix="41.100.5",
    )

    services.deconnecter(refresh_cookie=None)
    services.deconnecter(refresh_cookie="")
    services.deconnecter(refresh_cookie="pas-un-cookie")
    services.deconnecter(refresh_cookie=f"{uuid.uuid4()}.secret-inconnu")
    assert Session.objects.filter(user=utilisateur, revoked_at__isnull=True).count() == 1

    services.deconnecter(refresh_cookie=emise.refresh_token)
    premiere_revocation = Session.objects.get(user=utilisateur).revoked_at
    assert premiere_revocation is not None

    # Rejouer la déconnexion ne doit ni échouer ni réécrire l'horodatage de révocation.
    services.deconnecter(refresh_cookie=emise.refresh_token)
    assert Session.objects.get(user=utilisateur).revoked_at == premiere_revocation


@pytest.mark.django_db
def test_deconnecter_partout_est_idempotent(utilisateur: User, mot_de_passe: str) -> None:
    for _ in range(3):
        services.connecter(
            email=utilisateur.email,
            password=mot_de_passe,
            device_fingerprint="test",
            ip_prefix="41.100.5",
        )

    services.deconnecter_partout(user=utilisateur)
    services.deconnecter_partout(user=utilisateur)

    assert Session.objects.filter(user=utilisateur, revoked_at__isnull=True).count() == 0
    assert Session.objects.filter(user=utilisateur).count() == 3


@pytest.mark.django_db
def test_deconnecter_partout_ne_touche_pas_les_sessions_d_un_autre_compte(
    utilisateur: User, mot_de_passe: str
) -> None:
    autre = User.objects.create_user(email="autre@example.com", password=mot_de_passe)
    for compte in (utilisateur, autre):
        services.connecter(
            email=compte.email,
            password=mot_de_passe,
            device_fingerprint="test",
            ip_prefix="41.100.5",
        )

    services.deconnecter_partout(user=utilisateur)

    assert Session.objects.filter(user=autre, revoked_at__isnull=True).count() == 1


@pytest.mark.django_db
def test_rafraichir_avec_un_cookie_malforme_leve_jeton_invalide() -> None:
    for cookie in ["", "pas-de-point", "pas-un-uuid.secret"]:
        with pytest.raises(services.JetonInvalideError):
            services.rafraichir(
                refresh_cookie=cookie, device_fingerprint="test", ip_prefix="41.100.5"
            )


@pytest.mark.django_db
def test_rafraichir_conserve_l_empreinte_et_le_prefixe_quand_ils_sont_vides(
    utilisateur: User, mot_de_passe: str
) -> None:
    emise = services.connecter(
        email=utilisateur.email,
        password=mot_de_passe,
        device_fingerprint="appareil-initial",
        ip_prefix="41.100.5",
    )

    services.rafraichir(refresh_cookie=emise.refresh_token, device_fingerprint="", ip_prefix="")

    session = Session.objects.get(user=utilisateur)
    assert session.device_fingerprint == "appareil-initial"
    assert session.ip_prefix == "41.100.5"


@pytest.mark.django_db
def test_demander_reinitialisation_pour_un_email_inconnu_ne_cree_rien_et_n_echoue_pas() -> None:
    services.demander_reinitialisation(email="personne@example.com")

    assert PasswordResetToken.objects.count() == 0
    assert mail.outbox == []


@pytest.mark.django_db
def test_le_jeton_de_reinitialisation_n_est_jamais_stocke_en_clair(utilisateur: User) -> None:
    services.demander_reinitialisation(email=utilisateur.email)

    corps = str(mail.outbox[0].body)
    secret = corps.split("token=", 1)[1].split()[0]
    jeton = PasswordResetToken.objects.get(user=utilisateur)

    assert jeton.token_hash == hash_secret(secret)
    assert secret not in jeton.token_hash


@pytest.mark.django_db
def test_un_jeton_de_reinitialisation_expire_est_refuse(utilisateur: User) -> None:
    """Cas limite : TTL de 30 min dépassé (§4.2)."""
    services.demander_reinitialisation(email=utilisateur.email)
    secret = str(mail.outbox[0].body).split("token=", 1)[1].split()[0]
    PasswordResetToken.objects.filter(user=utilisateur).update(
        expires_at=timezone.now() - timedelta(minutes=1)
    )

    with pytest.raises(services.JetonInvalideError):
        services.confirmer_reinitialisation(token=secret, password="un-nouveau-mot-de-passe-1")


@pytest.mark.django_db
def test_confirmer_avec_un_jeton_inconnu_leve_jeton_invalide() -> None:
    with pytest.raises(services.JetonInvalideError):
        services.confirmer_reinitialisation(
            token="jeton-jamais-emis", password="un-nouveau-mot-de-passe-1"
        )


@pytest.mark.django_db
def test_confirmer_avec_un_mot_de_passe_invalide_ne_consomme_ni_le_jeton_ni_les_sessions(
    utilisateur: User, mot_de_passe: str
) -> None:
    """Atomicité : un échec de validation ne doit produire aucun effet partiel."""
    services.connecter(
        email=utilisateur.email,
        password=mot_de_passe,
        device_fingerprint="test",
        ip_prefix="41.100.5",
    )
    services.demander_reinitialisation(email=utilisateur.email)
    secret = str(mail.outbox[0].body).split("token=", 1)[1].split()[0]

    with pytest.raises(services.MotDePasseInvalideError):
        services.confirmer_reinitialisation(token=secret, password="court")

    assert PasswordResetToken.objects.get(user=utilisateur).used_at is None
    assert Session.objects.filter(user=utilisateur, revoked_at__isnull=True).count() == 1
    utilisateur.refresh_from_db()
    assert utilisateur.check_password(mot_de_passe)

    # Et le jeton reste utilisable avec un mot de passe correct.
    services.confirmer_reinitialisation(token=secret, password="un-nouveau-mot-de-passe-1")
    assert PasswordResetToken.objects.get(user=utilisateur).used_at is not None


@pytest.mark.django_db
def test_deux_demandes_de_reinitialisation_donnent_deux_jetons_utilisables_independamment(
    utilisateur: User,
) -> None:
    services.demander_reinitialisation(email=utilisateur.email)
    services.demander_reinitialisation(email=utilisateur.email)
    secrets_ = [str(m.body).split("token=", 1)[1].split()[0] for m in mail.outbox]

    assert len(set(secrets_)) == 2
    services.confirmer_reinitialisation(token=secrets_[1], password="un-nouveau-mot-de-passe-1")

    # Le premier jeton n'a pas été invalidé par l'usage du second : limite connue,
    # documentée ici pour que le comportement soit un choix visible et non une surprise.
    assert PasswordResetToken.objects.filter(user=utilisateur, used_at__isnull=True).count() == 1

"""Extraction de l'IP et calcul du préfixe réseau (§4.1.2 / §4.2)."""

import pytest
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.accounts.utils import get_client_ip, ip_prefix


def _requete(**meta: str) -> Request:
    fabrique = APIRequestFactory()
    django_request = fabrique.post("/api/auth/login")
    django_request.META.update(meta)
    return Request(django_request)


def test_l_ip_vient_de_x_forwarded_for_quand_next_la_transmet() -> None:
    requete = _requete(HTTP_X_FORWARDED_FOR="41.100.5.7", REMOTE_ADDR="172.18.0.4")

    assert get_client_ip(requete) == "41.100.5.7"


def test_seule_la_premiere_ip_de_la_chaine_est_retenue() -> None:
    requete = _requete(HTTP_X_FORWARDED_FOR=" 41.100.5.7 , 10.0.0.1, 172.18.0.4")

    assert get_client_ip(requete) == "41.100.5.7"


def test_sans_x_forwarded_for_on_retombe_sur_remote_addr() -> None:
    assert get_client_ip(_requete(REMOTE_ADDR="172.18.0.4")) == "172.18.0.4"


def test_un_x_forwarded_for_vide_ne_masque_pas_remote_addr() -> None:
    """Cas limite : un en-tête présent mais vide ne doit pas produire une clé de
    limitation de débit vide, qui regrouperait tous les visiteurs sur un seul compteur."""
    requete = _requete(HTTP_X_FORWARDED_FOR="", REMOTE_ADDR="172.18.0.4")

    assert get_client_ip(requete) == "172.18.0.4"


def test_sans_aucune_information_l_ip_est_une_chaine_vide() -> None:
    requete = _requete()
    requete.META.pop("REMOTE_ADDR", None)

    assert get_client_ip(requete) == ""


@pytest.mark.parametrize(
    ("ip", "prefixe"),
    [
        ("41.100.5.7", "41.100.5"),
        ("192.168.1.254", "192.168.1"),
        ("2001:db8:85a3:1:2:3:4:5", "2001:db8:85a3:1"),
        ("::1", "::1"),
        ("", ""),
        ("pas-une-ip", "pas-une-ip"),
        ("41.100.5", "41.100.5"),
    ],
)
def test_le_prefixe_reseau(ip: str, prefixe: str) -> None:
    assert ip_prefix(ip) == prefixe


def test_deux_ip_du_meme_reseau_partagent_le_prefixe() -> None:
    assert ip_prefix("41.100.5.7") == ip_prefix("41.100.5.200")
    assert ip_prefix("41.100.5.7") != ip_prefix("41.100.6.7")

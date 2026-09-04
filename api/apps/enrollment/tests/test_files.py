"""Pipeline d'assainissement des preuves (CLAUDE.md §4.5, checklist §8 point 7).

Chaque test correspond à une attaque nommée dans la checklist, pas à une ligne de code.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from apps.enrollment.files import (
    PIXELS_MAX,
    TAILLE_MAX_OCTETS,
    TYPE_PDF,
    FichierRefuseError,
    FichierTropVolumineuxError,
    assainir_preuve,
)
from apps.enrollment.tests.conftest import (
    SVG_MALVEILLANT,
    image_octets,
    pdf_octets,
    png_octets,
)


def test_un_jpeg_ordinaire_passe_et_ressort_en_jpeg() -> None:
    assainie = assainir_preuve(image_octets("JPEG"))

    assert assainie.content_type == "image/jpeg"
    assert Image.open(io.BytesIO(assainie.contenu)).format == "JPEG"


def test_un_png_ordinaire_passe_et_ressort_en_png() -> None:
    assainie = assainir_preuve(png_octets())

    assert assainie.content_type == "image/png"
    assert Image.open(io.BytesIO(assainie.contenu)).format == "PNG"


def test_un_png_avec_transparence_conserve_l_alpha_sans_les_metadonnees() -> None:
    """Le mode RGBA emprunte le chemin `garder_alpha` : reconstruction pixel par pixel."""
    sortie = io.BytesIO()
    Image.new("RGBA", (60, 60), (10, 20, 30, 180)).save(sortie, format="PNG")

    assainie = assainir_preuve(sortie.getvalue())

    reconstruite = Image.open(io.BytesIO(assainie.contenu))
    assert assainie.content_type == "image/png"
    assert reconstruite.format == "PNG"
    assert reconstruite.mode == "RGBA"


def test_un_svg_avec_script_est_refuse() -> None:
    """§4.5 : SVG explicitement interdit — c'est du XML qui exécute du script."""
    with pytest.raises(FichierRefuseError):
        assainir_preuve(SVG_MALVEILLANT)


def test_un_fichier_php_renomme_en_jpg_est_refuse() -> None:
    """L'extension et le Content-Type déclarés ne comptent pas : seuls les magic bytes."""
    with pytest.raises(FichierRefuseError):
        assainir_preuve(b"<?php system($_GET['c']); ?>" + b"\x00" * 100)


def test_un_html_deguise_est_refuse() -> None:
    with pytest.raises(FichierRefuseError):
        assainir_preuve(b"<html><body><script>alert(1)</script></body></html>")


def test_un_polyglotte_jpeg_plus_php_ressort_sans_la_charge() -> None:
    """Le fichier n'est pas nettoyé, il est refabriqué : seuls les pixels sont recopiés."""
    charge = b"<?php system($_GET['cmd']); ?>"
    polyglotte = image_octets("JPEG") + charge

    assainie = assainir_preuve(polyglotte)

    assert charge not in assainie.contenu
    assert b"<?php" not in assainie.contenu
    assert Image.open(io.BytesIO(assainie.contenu)).format == "JPEG"


def test_l_exif_est_detruit_par_le_reencodage() -> None:
    """§4.5 : une photo de reçu porte souvent la géolocalisation du domicile."""
    exif = Image.Exif()
    exif[271] = "AppareilSecret"  # Make
    exif[305] = "LogicielSecret"  # Software
    avec_exif = image_octets("JPEG", exif=exif.tobytes())
    assert Image.open(io.BytesIO(avec_exif)).getexif()

    assainie = assainir_preuve(avec_exif)

    assert not Image.open(io.BytesIO(assainie.contenu)).getexif()
    assert b"AppareilSecret" not in assainie.contenu
    assert b"LogicielSecret" not in assainie.contenu


def test_les_metadonnees_texte_d_un_png_ne_survivent_pas() -> None:
    from PIL.PngImagePlugin import PngInfo

    infos = PngInfo()
    infos.add_text("Commentaire", "charge-utile-a-ne-pas-conserver")
    sortie = io.BytesIO()
    Image.new("RGB", (60, 60), (10, 20, 30)).save(sortie, format="PNG", pnginfo=infos)

    assainie = assainir_preuve(sortie.getvalue())

    assert b"charge-utile-a-ne-pas-conserver" not in assainie.contenu


def test_un_fichier_de_100_mo_est_refuse_avant_tout_decodage() -> None:
    enorme = b"\xff\xd8\xff\xe0" + b"\x00" * (100 * 1024 * 1024)

    with pytest.raises(FichierTropVolumineuxError):
        assainir_preuve(enorme)


def test_la_limite_est_bien_a_cinq_mega_octets() -> None:
    with pytest.raises(FichierTropVolumineuxError):
        assainir_preuve(b"\xff\xd8\xff\xe0" + b"\x00" * TAILLE_MAX_OCTETS)


def test_un_fichier_vide_est_refuse() -> None:
    with pytest.raises(FichierRefuseError):
        assainir_preuve(b"")


def test_une_image_aux_dimensions_absurdes_est_refusee_sans_la_decompresser() -> None:
    """Bombe de décompression : quelques kilo-octets, des gigaoctets une fois décodés."""
    sortie = io.BytesIO()
    Image.new("L", (20000, 20000)).save(sortie, format="PNG")

    with pytest.raises(FichierRefuseError):
        assainir_preuve(sortie.getvalue())


def test_un_pdf_ordinaire_passe() -> None:
    assainie = assainir_preuve(pdf_octets())

    assert assainie.content_type == "application/pdf"


@pytest.mark.parametrize(
    "marqueur",
    [
        b"/JavaScript",
        b"/JS",
        b"/OpenAction",
        b"/AA",
        b"/Launch",
        b"/EmbeddedFile",
        b"/RichMedia",
    ],
)
def test_un_pdf_avec_un_marqueur_actif_est_refuse(marqueur: bytes) -> None:
    with pytest.raises(FichierRefuseError):
        assainir_preuve(pdf_octets(marqueur + b" 12 0 R"))


def test_un_pdf_sans_en_tete_est_refuse_meme_si_le_type_est_force(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Défense en profondeur : magic bytes et en-tête `%PDF-` doivent tous les deux passer."""
    monkeypatch.setattr("apps.enrollment.files._detecter_type", lambda _contenu: TYPE_PDF)

    with pytest.raises(FichierRefuseError, match="illisible"):
        assainir_preuve(b"ceci n'est pas un PDF")


def test_un_jpeg_tronque_est_refuse_comme_illisible() -> None:
    """Magic bytes JPEG, mais Pillow ne peut pas ouvrir : 400, pas 500."""
    tronque = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32

    with pytest.raises(FichierRefuseError, match="illisible"):
        assainir_preuve(tronque)


def test_une_image_sous_le_seuil_pillow_mais_au_dessus_du_notre_est_refusee() -> None:
    """PIXELS_MAX (50 Mpx) est plus strict que le garde-fou de Pillow (~179 Mpx)."""
    cote = int(PIXELS_MAX**0.5) + 50  # ~7 120 px → un peu au-dessus de 50 Mpx
    assert cote * cote > PIXELS_MAX
    sortie = io.BytesIO()
    Image.new("L", (cote, cote)).save(sortie, format="PNG")

    with pytest.raises(FichierRefuseError, match="trop grande"):
        assainir_preuve(sortie.getvalue())


def test_un_echec_au_reencodage_est_refuse_sans_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """`convert` / `frombytes` peuvent lever : l'étudiant reçoit un refus, pas une trace."""

    def _boom(self: Image.Image, *_args: object, **_kwargs: object) -> Image.Image:
        raise OSError("truncated")

    monkeypatch.setattr(Image.Image, "convert", _boom)

    with pytest.raises(FichierRefuseError, match="illisible"):
        assainir_preuve(image_octets())


def test_le_message_de_refus_ne_dit_pas_quel_type_a_ete_detecte() -> None:
    """Ne pas apprendre à l'expéditeur quelles familles de fichiers franchissent le filtre."""
    with pytest.raises(FichierRefuseError) as php:
        assainir_preuve(b"<?php echo 1; ?>" + b"\x00" * 64)
    with pytest.raises(FichierRefuseError) as svg:
        assainir_preuve(SVG_MALVEILLANT)

    assert str(php.value) == str(svg.value)

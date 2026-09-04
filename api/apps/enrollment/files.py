"""Validation et assainissement des preuves téléversées (CLAUDE.md §4.5).

Ordre des contrôles, et pourquoi il est dans cet ordre :

1. **Taille** d'abord — refuser 100 Mo ne doit pas coûter 100 Mo de traitement.
2. **Type réel par magic bytes**, jamais l'extension ni le `Content-Type` déclaré :
   les deux sont fournis par le client et ne prouvent rien. Allow-list stricte
   JPEG / PNG / PDF. **SVG interdit explicitement** (c'est un document XML qui exécute
   du script) : il tombe de toute façon hors de l'allow-list, le test le vérifie.
3. **Dimensions** avant décodage — une image de 60 000 sur 60 000 pixels tient dans
   quelques kilo-octets compressés et fait exploser la mémoire à la décompression.
4. **Réencodage Pillow** — on ne « nettoie » pas le fichier reçu, on en fabrique un
   neuf à partir des seuls pixels (`Image.frombytes`). EXIF, chunks de texte PNG,
   profils, données concaténées après le marqueur de fin : rien ne survit, parce que
   rien n'est recopié. C'est ce qui neutralise le polyglotte JPEG + PHP.

Le PDF est le cas non réductible : il n'existe pas d'équivalent de « ne garder que les
pixels ». On le refuse s'il porte les marqueurs d'un comportement actif, et surtout on
ne le sert jamais en ligne — voir `views.AdminProofFileView` (`Content-Disposition:
attachment`, `nosniff`). Le risque résiduel est documenté dans progress.md.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import magic
from PIL import Image, UnidentifiedImageError
from PIL.Image import DecompressionBombError

TAILLE_MAX_OCTETS = 5 * 1024 * 1024
PIXELS_MAX = 50_000_000

TYPE_JPEG = "image/jpeg"
TYPE_PNG = "image/png"
TYPE_PDF = "application/pdf"
TYPES_AUTORISES = frozenset({TYPE_JPEG, TYPE_PNG, TYPE_PDF})

# Marqueurs d'un PDF qui fait autre chose que s'afficher. Ce filtre est une défense en
# profondeur, pas une garantie : un objet compressé peut les masquer. La vraie
# protection reste de ne jamais servir le fichier en ligne.
_MARQUEURS_PDF_ACTIFS = (
    b"/JavaScript",
    b"/JS",
    b"/OpenAction",
    b"/AA",
    b"/Launch",
    b"/EmbeddedFile",
    b"/RichMedia",
)


class FichierRefuseError(Exception):
    """Fichier rejeté. Le message est destiné à l'étudiant : il dit quoi corriger (§6)."""


class FichierTropVolumineuxError(FichierRefuseError):
    """Séparé pour que la vue réponde 413 plutôt que 400."""


@dataclass(frozen=True)
class PreuveAssainie:
    contenu: bytes
    content_type: str


def _detecter_type(contenu: bytes) -> str:
    return magic.from_buffer(contenu[:2048], mime=True)


def _assainir_image(contenu: bytes, type_detecte: str) -> PreuveAssainie:
    try:
        source = Image.open(io.BytesIO(contenu))
    except DecompressionBombError as exc:
        # Pillow a son propre garde-fou, plus haut que le nôtre, et il lève depuis
        # `open()` — donc avant qu'on ait pu regarder `size`. Sans cette branche, une
        # bombe de décompression sortait en 500 au lieu d'un refus propre.
        raise FichierRefuseError(
            "Cette image est trop grande. Envoie une capture d'écran simple."
        ) from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise FichierRefuseError("Cette image est illisible. Envoie une nouvelle capture.") from exc

    largeur, hauteur = source.size
    if largeur * hauteur > PIXELS_MAX:
        # Sous le seuil de Pillow (qui ne lève qu'au-delà du double de MAX_IMAGE_PIXELS)
        # mais au-dessus du nôtre : une capture de reçu n'a pas à être si grande.
        raise FichierRefuseError("Cette image est trop grande. Envoie une capture d'écran simple.")

    garder_alpha = type_detecte == TYPE_PNG and source.mode in {"RGBA", "LA", "P"}
    mode_cible = "RGBA" if garder_alpha else "RGB"

    try:
        normalisee = source.convert(mode_cible)
        # Reconstruction depuis les seuls octets de pixels : aucune métadonnée de
        # l'original n'est recopiée (`info` de l'image neuve est vide).
        propre = Image.frombytes(mode_cible, normalisee.size, normalisee.tobytes())
    except (OSError, ValueError) as exc:
        raise FichierRefuseError("Cette image est illisible. Envoie une nouvelle capture.") from exc

    sortie = io.BytesIO()
    if type_detecte == TYPE_JPEG:
        propre.save(sortie, format="JPEG", quality=88, optimize=True)
    else:
        propre.save(sortie, format="PNG", optimize=True)

    return PreuveAssainie(contenu=sortie.getvalue(), content_type=type_detecte)


def _verifier_pdf(contenu: bytes) -> PreuveAssainie:
    if not contenu.startswith(b"%PDF-"):
        raise FichierRefuseError("Ce PDF est illisible. Envoie une capture d'écran à la place.")
    for marqueur in _MARQUEURS_PDF_ACTIFS:
        if marqueur in contenu:
            raise FichierRefuseError(
                "Ce PDF contient des éléments actifs. Envoie une capture d'écran à la place."
            )
    return PreuveAssainie(contenu=contenu, content_type=TYPE_PDF)


def assainir_preuve(contenu: bytes) -> PreuveAssainie:
    """Renvoie un fichier reconstruit, ou lève `FichierRefuseError` avec un message utile."""
    if not contenu:
        raise FichierRefuseError("Le fichier est vide. Choisis une capture du reçu.")
    if len(contenu) > TAILLE_MAX_OCTETS:
        raise FichierTropVolumineuxError("Le fichier dépasse 5 Mo. Envoie une capture plus légère.")

    type_detecte = _detecter_type(contenu)
    if type_detecte not in TYPES_AUTORISES:
        # Message identique quel que soit le type refusé : ne pas apprendre à
        # l'expéditeur quelles familles de fichiers passent le filtre.
        raise FichierRefuseError("Format non accepté. Envoie une image JPEG ou PNG, ou un PDF.")

    if type_detecte == TYPE_PDF:
        return _verifier_pdf(contenu)
    return _assainir_image(contenu, type_detecte)

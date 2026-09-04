"""Sème la vraie arborescence de la première formation (§1, étape 2).

Idempotent : `update_or_create` partout, on peut le rejouer sans dupliquer. Le
contenu du Module 0 est réel — c'est le chapitre 1 qui joue dans le hero de la
landing (§6) — le reste de la formation est posé en structure, à enrichir aux
étapes suivantes.
"""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.catalog.models import Chapter, Course, Lesson, Module

TRANSCRIPT_CHAPITRE_1 = """\
Avant d'écrire une ligne de Dart, on installe l'outillage. Trois choses, dans l'ordre :
le SDK Flutter, un éditeur, et un endroit où faire tourner l'application pendant qu'on
apprend.

## 1. Le SDK Flutter

Télécharge le SDK depuis flutter.dev et décompresse-le dans un dossier sans espace ni
accent dans le chemin (`~/dev/flutter`, pas `~/Mes Documents/flutter`). Ajoute-le au
`PATH` :

```
export PATH="$PATH:$HOME/dev/flutter/bin"
```

Vérifie que tout est en ordre :

```
flutter doctor
```

`flutter doctor` liste ce qui manque : Android SDK, licences à accepter, éditeur non
détecté. Ne passe pas à la suite tant qu'il reste une croix rouge sur les lignes qui te
concernent — un doctor propre maintenant t'évite une heure de diagnostic plus tard.

## 2. L'éditeur

VS Code avec l'extension officielle "Flutter" suffit largement pour commencer. Elle
installe automatiquement l'extension Dart. Une fois installée, VS Code sait lancer et
recharger une application Flutter sans passer par le terminal.

## 3. Un endroit où lancer l'app

Le plus rapide pour débuter : un émulateur Android. Ouvre Android Studio une fois,
crée un appareil virtuel (Pixel, dernière version d'Android), et démarre-le. Une fois
lancé, `flutter devices` doit le lister.

## Vérification finale

```
flutter create mon_app
cd mon_app
flutter run
```

Si un écran avec un compteur et un bouton `+` apparaît sur l'émulateur, l'installation
est correcte. Ce compteur, c'est le prochain chapitre : on va le lire, le comprendre,
et le casser exprès pour voir comment Flutter réagit.
"""

RESSOURCES_CHAPITRE_1: list[dict[str, str]] = [
    {
        "titre": "Documentation officielle flutter doctor",
        "url": "https://docs.flutter.dev/get-started/install",
    },
    {"titre": "Extension VS Code Flutter", "url": "https://docs.flutter.dev/tools/vs-code"},
]


class Command(BaseCommand):
    help = "Sème la formation Flutter + Firebase pour débutants absolus."

    @transaction.atomic
    def handle(self, *args: Any, **options: Any) -> None:
        course, _ = Course.objects.update_or_create(
            slug="flutter-firebase-debutants",
            defaults={
                "title": "Flutter + Firebase pour débutants absolus",
                "description": (
                    "Construis et publie une vraie application mobile avec Flutter et "
                    "Firebase, en partant de zéro — sans expérience de programmation "
                    "préalable."
                ),
                "is_published": True,
            },
        )

        module_0, _ = Module.objects.update_or_create(
            course=course,
            order=0,
            defaults={
                "title": "Mise en route",
                "summary": (
                    "Installer l'outillage, comprendre le compteur par défaut, écrire "
                    "ton premier widget."
                ),
            },
        )

        chapitre_1, _ = Chapter.objects.update_or_create(
            module=module_0,
            order=1,
            defaults={
                "slug": "installer-flutter-et-configurer-ton-editeur",
                "title": "Installer Flutter et configurer ton éditeur",
                "is_free": True,
            },
        )
        Lesson.objects.update_or_create(
            chapter=chapitre_1,
            defaults={
                "video_provider_id": "",
                "duration_s": 480,
                "transcript": TRANSCRIPT_CHAPITRE_1,
                "resources": RESSOURCES_CHAPITRE_1,
            },
        )

        chapitre_2, _ = Chapter.objects.update_or_create(
            module=module_0,
            order=2,
            defaults={
                "slug": "ton-premier-widget",
                "title": "Ton premier widget : Hello Algérie",
                "is_free": False,
            },
        )
        Lesson.objects.get_or_create(chapter=chapitre_2, defaults={"duration_s": 600})

        chapitre_3, _ = Chapter.objects.update_or_create(
            module=module_0,
            order=3,
            defaults={
                "slug": "comprendre-le-hot-reload",
                "title": "Comprendre le Hot Reload",
                "is_free": False,
            },
        )
        Lesson.objects.get_or_create(chapter=chapitre_3, defaults={"duration_s": 420})

        module_1, _ = Module.objects.update_or_create(
            course=course,
            order=1,
            defaults={
                "title": "Les fondamentaux de Dart",
                "summary": "Variables, fonctions, classes : le langage derrière chaque widget.",
            },
        )
        for order, (slug, titre, duree) in enumerate(
            [
                ("variables-et-types", "Variables et types", 540),
                ("fonctions-et-parametres", "Fonctions et paramètres", 600),
                ("classes-et-objets", "Classes et objets", 660),
            ],
            start=1,
        ):
            chapitre = Chapter.objects.update_or_create(
                module=module_1,
                order=order,
                defaults={"slug": slug, "title": titre, "is_free": False},
            )[0]
            Lesson.objects.get_or_create(chapter=chapitre, defaults={"duration_s": duree})

        self.stdout.write(self.style.SUCCESS(f"Formation « {course.title} » semée."))

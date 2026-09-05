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

from apps.assessment.models import Choice, Question, Quiz
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


def _semer_qcm(*, quiz: Quiz, questions: list[tuple[str, str, list[tuple[str, bool]]]]) -> None:
    """`questions` : liste de `(texte, explication, [(texte_choix, est_correct), ...])`,
    une seule bonne réponse par question (§7 — imposé aussi en base, voir
    `choice_une_seule_bonne_reponse_par_question`)."""
    for ordre, (texte, explication, choix) in enumerate(questions, start=1):
        question, _ = Question.objects.update_or_create(
            quiz=quiz, order=ordre, defaults={"text": texte, "explanation": explication}
        )
        for ordre_choix, (texte_choix, correct) in enumerate(choix, start=1):
            Choice.objects.update_or_create(
                question=question,
                order=ordre_choix,
                defaults={"text": texte_choix, "is_correct": correct},
            )


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
        quiz_chapitre_1, _ = Quiz.objects.update_or_create(
            chapter=chapitre_1,
            defaults={"pass_threshold": 60, "max_attempts": 3, "min_duration_s": 20},
        )
        _semer_qcm(
            quiz=quiz_chapitre_1,
            questions=[
                (
                    "Que vérifie la commande `flutter doctor` ?",
                    "`flutter doctor` liste ce qui manque à l'installation — SDK Android, "
                    "licences à accepter, éditeur non détecté.",
                    [
                        (
                            "Que l'installation de Flutter est complète et bien configurée",
                            True,
                        ),
                        ("Que l'application compile sans erreur", False),
                    ],
                ),
                (
                    "Quel éditeur le chapitre recommande-t-il pour commencer ?",
                    "VS Code avec l'extension officielle Flutter, qui installe aussi "
                    "l'extension Dart.",
                    [
                        ("VS Code avec l'extension Flutter", True),
                        ("Un éditeur de texte sans extension particulière", False),
                    ],
                ),
                (
                    "Que confirme l'apparition d'un compteur et d'un bouton « + » après "
                    "`flutter run` ?",
                    "C'est le signe que l'installation fonctionne de bout en bout — SDK, "
                    "éditeur et émulateur.",
                    [
                        ("Que l'installation est correcte", True),
                        ("Qu'il faut réinstaller le SDK", False),
                    ],
                ),
            ],
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

        examen_module_0, _ = Quiz.objects.update_or_create(
            module=module_0,
            defaults={"pass_threshold": 60, "max_attempts": 3, "min_duration_s": 20},
        )
        _semer_qcm(
            quiz=examen_module_0,
            questions=[
                (
                    "Qu'est-ce qu'un widget en Flutter ?",
                    "En Flutter, tout élément d'interface — texte, bouton, mise en page — "
                    "est un widget.",
                    [
                        ("Un composant qui décrit une partie de l'interface", True),
                        ("Un fichier de configuration du projet", False),
                    ],
                ),
                (
                    "À quoi sert le Hot Reload ?",
                    "Le Hot Reload recharge le code modifié dans l'application déjà "
                    "lancée, sans redémarrer l'émulateur ni perdre l'état de navigation.",
                    [
                        (
                            "Voir les changements de code presque instantanément, sans "
                            "relancer l'app",
                            True,
                        ),
                        ("Publier l'application sur le store", False),
                    ],
                ),
                (
                    "Quelle commande vérifie que l'installation de Flutter est correcte ?",
                    "`flutter doctor` est l'outil de diagnostic officiel de l'installation.",
                    [
                        ("flutter doctor", True),
                        ("flutter publish", False),
                    ],
                ),
            ],
        )

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

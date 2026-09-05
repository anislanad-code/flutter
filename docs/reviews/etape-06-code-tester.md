# Étape 06 — Rapport de test

**Date** · 2026-09-05
**Branche** · `claude/etape-06-qcm-examens`
**Agent** · `code-tester` (CLAUDE.md §8, agent 2)
**Base au démarrage** · `2b8bc4f` « feat: étape 6 — QCM de chapitre et examens de module »
**Base à la clôture** · `205f521` « sec: corriger le formatage (BLOQUANT) et une fuite de contenu non publié (étape 6) »

Aucun code de production n'a été modifié par cet agent. **Un test rouge écrit ici a
révélé une fuite de contenu réelle** (`GET /api/quizzes/{id}` servait le contenu d'une
formation non publiée) ; elle a été corrigée pendant la session dans `205f521`, et le
test qui l'avait attrapée reste en place comme garde de non-régression. Détail en
« Tests rouges ».

## Environnement

| Composant | Version / valeur |
|---|---|
| Exécution | locale (`uv` + `npm`), pas de Docker dans cette session |
| Python | 3.12.3 |
| Django / DRF | 5.2.17 / 3.18.0 |
| PostgreSQL | 16 (cluster `16/main`, base réelle `anisdev`, **jamais SQLite**) |
| Node / Vitest | Node 22 / Vitest 5.0.0 |
| Next.js | 15.5.25 |
| Réglages Django | `DJANGO_SETTINGS_MODULE=config.settings.dev`, variables de `.env.example` |

> **Incident d'environnement, sans rapport avec le code.** En cours de session, le rôle
> PostgreSQL `anisdev` a cessé d'accepter `change-moi-en-local` (mot de passe modifié
> hors de cette session — le rapport `etape-06-security-tester.md` signale le même
> symptôme). `ALTER USER anisdev WITH PASSWORD 'change-moi-en-local'` a rétabli l'accès ;
> tous les résultats ci-dessous viennent d'exécutions où la base répondait. Aucun test
> n'a été marqué « skip » à cause de ça.

## Commandes exécutées

```
# Backend, depuis api/
uv run pytest -q --cov=apps --cov=config --cov-report=term-missing
uv run pytest -q --cov=apps.assessment --cov=apps.learning --cov-report=term-missing
uv run pytest apps/accounts/tests/test_invariantes.py tests/test_security_baseline.py -q
uv run ruff check . ; uv run ruff format --check . ; uv run mypy apps config

# Frontend, depuis web/
npm run test:cov
npm run lint ; npx tsc --noEmit
API_INTERNAL_URL=… NEXT_PUBLIC_SITE_URL=… npm run build
```

## Inventaire des unités introduites par l'étape

| Unité | Type | Couverte par |
|---|---|---|
| `GET /api/quizzes/{id}` | endpoint | `test_views`, `test_cloisonnement`, `test_anti_triche` |
| `POST /api/quizzes/{id}/attempts` | endpoint | `test_views`, `test_anti_triche`, `test_cloisonnement` |
| `POST /api/attempts/{id}/submit` | endpoint | `test_views`, `test_anti_triche`, `test_cloisonnement` |
| `a_acces_au_quiz` | service (paywall) | `test_cloisonnement` (7 cas) |
| `etat_quiz` | service | `test_services`, `test_anti_triche` |
| `demarrer_tentative` | service (atomique, idempotent) | `test_anti_triche` (quota, réutilisation) |
| `soumettre_tentative` | service (atomique) | `test_anti_triche` (17 cas), `test_services` |
| `_mettre_a_jour_completion_module` | service | `test_services`, `test_anti_triche`, `test_deverrouillage_par_examen` |
| `SubmitRequestSerializer` (validation) | serializer | `test_anti_triche` (11 corps malformés) |
| `EtatQuizSerializer` / `ChoixPublicSerializer` | serializers | `test_cloisonnement` (fuite) |
| `ResultatTentativeSerializer` / `ChoixCorrigeSerializer` | serializers | `test_views`, `test_anti_triche` |
| `Quiz`/`Question`/`Choice`/`Attempt` + migration | modèles | `test_contraintes` (7 cas), `test_models` |
| `AttemptAdmin` (lecture seule) | admin | `test_models` |
| `calculer_pipeline` (déverrouillage par examen) | service modifié | `test_deverrouillage_par_examen` (11 cas) |
| `Qcm.tsx` | composant client | `qcm-composant`, `qcm-composant-cas-limites` (27 cas) |
| `/app/qcm/[id]` | page serveur | `qcm-page`, `qcm-page-cas-limites` |
| BFF `POST /api/quizzes/[id]/attempts` | route handler | `quiz-attempts-route`, `qcm-bff-cas-limites` |
| BFF `POST /api/attempts/[id]/submit` | route handler | `attempt-submit-route`, `qcm-bff-cas-limites` |
| `lib/assessment.ts`, `lib/assessment-schemas.ts` | lib | `lib-assessment` |
| Liens QCM/examen dans `LecteurChapitre` / `Pipeline` | composants modifiés | `composants-marketing`, `pipeline-composants` |

### Chemins exercés, par endpoint

| Endpoint | Nominal | Non authentifié | Authentifié non autorisé | Payload invalide | 404 | Cas limite métier |
|---|---|---|---|---|---|---|
| `GET /api/quizzes/{id}` | questions + choix sans `is_correct` | 401 | `PENDING` sur QCM payant · actif sur **une autre formation** · sans inscription · `BLOCKED` · formation dépubliée → 404 | — | id inexistant, **même corps** que le refus | quota épuisé (`attempts_remaining` 0, `best_score`), 429 au 61ᵉ appel |
| `POST /api/quizzes/{id}/attempts` | 201, `{id, started_at}` | 401 | idem (5 chemins) → 404 | corps forgé (`user`, `score`, `submitted_at`) ignoré | id inexistant | réutilisation d'une tentative ouverte (5 clics → 1 tentative), quota atteint → 409, `max_attempts = 0` → 409, 429 au 31ᵉ |
| `POST /api/attempts/{id}/submit` | score calculé + explications | 401 | tentative d'un tiers → 404, **même corps** qu'un id inexistant | 11 corps malformés → 400 | id inexistant | plancher exact (accepté) / plancher −1 s (400) · double soumission (409) · quiz sans question · seuil 0 · réponses partielles · question sans bonne réponse · arrondi 33 % · 429 au 31ᵉ |

## Tests ajoutés

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `api/apps/assessment/tests/test_anti_triche.py` *(nouveau)* | Durée plancher à la seconde près et sans consommation de tentative, quota (ouverte ≠ soumise, quota 0, état renvoyé), double soumission qui n'écrase rien, atomicité des refus, score et privilèges non influençables par le corps, 11 payloads malformés, six cas limites de barème | 30 |
| `api/apps/assessment/tests/test_cloisonnement.py` *(nouveau)* | Paywall scopé par formation, compte sans inscription, compte `BLOCKED`, **formation dépubliée**, absence d'oracle 404, IDOR (tentative d'un tiers intacte, états non mélangés, `ModuleCompletion` isolée), fuites (`is_correct`, `explanation`, URL vidéo, champs internes), texte hostile en JSON | 17 |
| `api/apps/assessment/tests/test_contraintes.py` *(nouveau)* | Les invariantes du §5 tiennent **en base** : XOR chapitre/module, quiz orphelin refusé, ordre unique par quiz, `OneToOne` chapitre et module, ordre de sortie stable, cascade de suppression | 7 |
| `api/apps/learning/tests/test_deverrouillage_par_examen.py` *(nouveau)* | Nouvelle règle de `calculer_pipeline` : chapitres terminés **et** examen réussi, examen échoué / réussi trop tôt, persistance au rechargement, module sans examen (non-régression étape 5), `quiz_id`/`exam_quiz_id` corrects, aucune fuite de contenu de QCM dans le pipeline, soft gating (QCM d'un module verrouillé accessible), examen vide (caractérisation, cf. MAJEUR 2 de la revue) | 11 |
| `web/tests/qcm-composant-cas-limites.test.tsx` *(nouveau)* | Tous les chemins d'erreur du composant (réseau, 500, 409, corps hors schéma, 401 à l'envoi, 400 illisible), états de chargement (`Préparation…` désactivé, `role=status` à l'envoi), navigation clavier complète, retour arrière, récapitulatif d'examen, écran de résultat (échec, sans explication, sans tentative, sans bonne réponse), rendu d'un HTML hostile, corps envoyé limité à `answers` | 27 |
| `web/tests/qcm-bff-cas-limites.test.ts` *(nouveau)* | Branches restantes des deux Route Handlers : 401 de Django non recopié, statut inattendu → 404 neutre, 400/409 sans `detail`, corps illisible, champs en trop non relayés, encodage de l'id, aucune URL interne dans une erreur | 10 |
| `web/tests/qcm-page-cas-limites.test.tsx` *(nouveau)* | Titre distinct de l'examen de module, 8 identifiants d'URL hors forme refusés sans appel serveur, redirection avant lecture, aucun contenu rendu quand la lecture échoue, `sans_session` ≠ `inaccessible` | 12 |
| `web/tests/invariantes-rendu-html.test.ts` *(nouveau)* | Invariante rejouable : `dangerouslySetInnerHTML` nulle part sauf le JSON-LD de la landing (qui échappe `<`), pas d'`innerHTML`/`eval` dans `Qcm.tsx`, pas de `localStorage`/`sessionStorage`, aucun composant ne vise Django directement | 6 |
| `web/tests/lib-assessment.test.ts` *(complété)* | 429 et 401 → `indisponible` (jamais `inaccessible`), chemin et `acceptStatuses` de l'appel | +3 |

**Total ajouté : 123 cas** (65 backend, 58 frontend).

### Trous réellement comblés

Les tests livrés avec l'étape couvraient bien les cinq critères « Terminé quand » et le
chemin nominal. Les manques portaient sur les bords :

1. **Anti-triche — la frontière du plancher n'était pas testée.** Un seul test
   (« refuse avant la durée plancher ») existait, sans jamais vérifier l'acceptation à
   la seconde exacte, ni surtout qu'un refus **ne consomme pas** de tentative :
   `test_une_soumission_trop_rapide_ne_consomme_aucune_tentative_et_ne_note_rien` le
   prouve maintenant (`submitted_at` nul, `score` nul, `answers` vide, `attempts_used`
   inchangé côté API).
2. **Quota — la confusion « tentative ouverte » / « tentative soumise ».** Personne ne
   vérifiait que cinq ouvertures successives ne brûlent qu'une tentative, ni que
   `max_attempts = 0` refuse d'emblée, ni que `GET /api/quizzes/{id}` annonce
   honnêtement `attempts_remaining` et `best_score` après épuisement.
3. **Double soumission — le 409 était testé, pas ses conséquences.** Rejouer une
   soumission avec de *meilleures* réponses ne doit pas remonter le score ;
   `test_la_seconde_soumission_est_refusee_et_nefface_pas_la_premiere` et
   `test_un_examen_rejoue_ne_regonfle_pas_module_completion` le fixent.
4. **Atomicité.** Aucun test n'établissait qu'un refus en milieu de `soumettre_tentative`
   (réponses invalides) ne laisse rien derrière lui — ni `submitted_at`, ni score, ni
   `ModuleCompletion` créée pour un examen.
5. **Paywall scopé par formation.** L'ÉLEVÉ E1 de l'étape 5 (une inscription active sur
   une formation n'ouvre pas une autre) n'avait jamais été rejoué sur `apps.assessment` :
   c'est un point d'API neuf qui refait le même contrôle, il devait être retesté ici.
   Il tient (404 sur les deux endpoints, aucune tentative créée).
6. **Formation dépubliée** — voir « Tests rouges » : ce chemin manquait, et il était
   effectivement ouvert.
7. **Absence d'oracle.** Les 404 étaient testés par leur code, pas par leur *corps* : un
   quiz interdit et un quiz inexistant renvoient désormais, en test, le même JSON — de
   même pour la tentative d'un tiers.
8. **Payloads malformés.** `SubmitRequestSerializer` n'était exercé que par une clé non
   numérique. Onze formes sont maintenant couvertes (`answers` absent, `null`, liste,
   chaîne, valeur non entière, 0, négative, flottante, clé nulle ou négative), toutes
   sans écriture en base.
9. **Contraintes de base.** `quiz_xor_chapitre_module`, `question_ordre_unique_par_quiz`
   et les deux `OneToOne` n'étaient vérifiés par aucun test : ils sont dans la migration,
   ils doivent tenir même si un jour du code contourne les services.
10. **Chemins d'erreur du composant `Qcm`.** 76 % de branches seulement : rien ne
    couvrait la coupure réseau, le corps hors schéma, le 500, le 409, le 401 à l'envoi,
    l'état d'envoi, le bouton « Précédent », le bouton « Modifier » du récapitulatif,
    l'écran de résultat en échec, ni la navigation clavier — que le §6 impose pourtant
    sur *tout* l'écran étudiant.
11. **Rendu des explications.** Le plan de l'étape exige « pas de
    `dangerouslySetInnerHTML` sur du contenu non nettoyé » ; aucun test ne le
    garantissait. `invariantes-rendu-html.test.ts` en fait une invariante rejouable à
    chaque étape, et un test de rendu vérifie qu'un `<img onerror=…>` dans une
    explication ressort en texte (aucun `<img>` dans le DOM).

## Résultats

### Backend — suite complète (étapes 0 à 6)

```
645 passed in 85.56s (0:01:25)
```

```
All checks passed!                            (ruff check .)
145 files already formatted                   (ruff format --check .)
Success: no issues found in 150 source files  (mypy --strict apps config)
```

### Frontend — suite complète (étapes 0 à 6)

```
 Test Files  45 passed (45)
      Tests  619 passed (619)
```

```
> eslint .       → aucune sortie
> tsc --noEmit   → aucune sortie
> next build     → EXIT=0
```

`next build` (leçon de l'étape 0 : vérifier un vrai build de production) : les trois
routes neuves sortent bien en `ƒ` (rendues à la demande), aucune n'est prérendue en
statique.

```
├ ƒ /api/attempts/[id]/submit              192 B         103 kB
├ ƒ /api/quizzes/[id]/attempts             192 B         103 kB
├ ƒ /app/qcm/[id]                        2.58 kB         131 kB
```

## Couverture

### Backend — code de l'étape 6

```
Name                             Stmts   Miss  Cover   Missing
--------------------------------------------------------------
apps/assessment/admin.py            35      0   100%
apps/assessment/models.py           51      0   100%
apps/assessment/serializers.py      57      0   100%
apps/assessment/services.py        138      0   100%
apps/assessment/urls.py              4      0   100%
apps/assessment/views.py            69      0   100%
apps/learning/admin.py              24      0   100%
apps/learning/models.py             30      0   100%
apps/learning/serializers.py        29      0   100%
apps/learning/services.py          113      0   100%
apps/learning/urls.py                4      0   100%
apps/learning/views.py              50      0   100%
--------------------------------------------------------------
TOTAL                              612      0   100%
```

**100 %** sur le code de l'étape, contre 99 % au démarrage de cette passe. Les trois
lignes gagnées :

| Ligne | Ce qui manquait | Test qui la couvre |
|---|---|---|
| `assessment/serializers.py:94` | identifiant de question nul ou négatif | `test_un_identifiant_de_question_nul_ou_negatif_est_refuse` (3 cas) |
| `assessment/services.py:215` | réponse désignant la question d'un **autre** quiz | `test_une_reponse_qui_designe_la_question_dun_autre_quiz_est_refusee` |
| `assessment/services.py:62` | examen de module d'une formation dépubliée (branche ajoutée par le correctif `205f521`) | `test_le_quiz_dune_formation_depubliee_nest_pas_servi` |

Couverture globale du backend : **99 %** (2482 instructions, 1 non couverte).

| Ligne non couverte | Pourquoi elle compte, ou pas |
|---|---|
| `apps/enrollment/views.py:72` | Refus précoce sur `CONTENT_LENGTH` non entier lors du dépôt d'une preuve. Héritée de l'étape 3, déjà documentée dans `etape-03-code-tester.md` ; hors périmètre de l'étape 6, et le chemin fonctionnel (fichier > 5 Mo) est couvert. |

### Frontend — code de l'étape 6

```
Statements   : 98.22% ( 1327/1351 )
Branches     : 96.79% (  907/937 )
Functions    : 96.19% (  202/210 )
Lines        : 99.51% ( 1232/1238 )
```

| Fichier de l'étape 6 | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `components/assessment/Qcm.tsx` | 98,79 % | **97,01 %** | 100 % | **100 %** |
| `app/(student)/app/qcm/[id]/page.tsx` | 100 % | 100 % | 100 % | 100 % |
| `app/api/quizzes/[id]/attempts/route.ts` | 100 % | 100 % | 100 % | 100 % |
| `app/api/attempts/[id]/submit/route.ts` | 100 % | 100 % | 100 % | 100 % |
| `lib/assessment.ts` | 100 % | 100 % | 100 % | 100 % |
| `lib/assessment-schemas.ts` | 100 % | 100 % | 100 % | 100 % |

Avant cette passe : `Qcm.tsx` 80,72 % d'instructions et **76,11 % de branches** (sous la
cible de 80 %), `submit/route.ts` 86,66 % de branches, `attempts/route.ts` 92,85 %,
`lib/assessment.ts` 90 %, `page.tsx` 91,66 %. Tout est au-dessus de 95 % désormais.

**Lignes non couvertes qui comptent, dans `Qcm.tsx` — deux branches mortes :**

| Emplacement | Constat | Conséquence |
|---|---|---|
| `Qcm.tsx:258` — `choisi ? choisi.text : "Pas de réponse"` | Inatteignable. Le récapitulatif d'examen n'est affiché qu'après la dernière question, et « Suivant » / « Vérifier avant d'envoyer » restent désactivés tant que la question courante n'a pas de réponse ; rien ne permet non plus de *désélectionner* un choix. Donc toute question listée dans le récapitulatif a forcément une réponse. | Code mort (MINEUR). Le test `le récapitulatif liste toutes les questions avec la réponse retenue` fixe l'invariante côté produit plutôt que d'inventer un état impossible. |
| `Qcm.tsx:285` — `if (!question) return null` | Inatteignable : `index` n'est fabriqué que par le composant lui-même, borné par `quiz.questions.length`. | Garde défensive (MINEUR), acceptable ; signalée pour information. |
| `Qcm.tsx:38,109` — `attemptsRestantes` (état local) | Observable nulle part : le seul écran qui l'utilise est l'introduction, et on n'y revient que par « Recommencer », bouton qui n'existe que si `attempts_remaining > 0` — la valeur mise à jour ne peut donc jamais franchir le seuil qui changerait l'affichage. | État sans effet (MINEUR). Le compteur reste juste parce que le serveur tranche à chaque appel. |

**Hors périmètre de l'étape** : `components/course/LecteurChapitre.tsx:40-43` (rendu d'un
bloc « titre » de transcript, hérité de l'étape 2) et `LecteurSecurise.tsx:70-73`
(hérité de l'étape 4, déjà documenté). Le lien « Passer le QCM du chapitre » ajouté par
l'étape 6 dans ce même fichier est couvert (`composants-marketing.test.tsx`), tout comme
le lien « Passer l'examen du module » du `Pipeline` (`pipeline-composants.test.tsx`).

## Invariantes du §4 rejouées (obligatoires à chaque étape)

| Invariante | Test | Résultat |
|---|---|---|
| Un serializer de `Choice` ne sérialise jamais `is_correct` | `tests/test_security_baseline.py::test_aucun_serializer_n_expose_is_correct` (introspection des champs) + `apps/accounts/tests/test_invariantes.py` (grille texte) + `test_cloisonnement::test_aucune_reponse_anterieure_a_la_soumission_ne_porte_is_correct` | vert |
| Aucune réponse d'API ne contient d'URL de fichier vidéo | `test_cloisonnement::test_aucune_reponse_de_letape_ne_porte_durl_de_fichier_video` (`.mp4`, `.m3u8`, `b-cdn.net`, `video_provider_id`, `bcdn_token` sur les 3 endpoints) + `test_deverrouillage_par_examen` pour le pipeline | vert |
| Un compte `PENDING` n'obtient que le chapitre `is_free` | `test_views::test_quiz_paywall_…`, `test_cloisonnement` (5 chemins de refus), `test_deverrouillage_par_examen::test_un_compte_pending_ne_recoit_quun_pointeur_dexamen_jamais_son_contenu` | vert |
| Les cookies d'auth portent `httpOnly`, `Secure`, `SameSite=Strict` | `web/tests/invariantes-cookies.test.ts` (aucune route de l'étape 6 ne pose de cookie ; les deux BFF relaient seulement) | vert |
| Aucune route ne permet de définir le mot de passe d'un tiers | `tests/test_security_baseline.py` + `test_urls.py` (le routage n'expose que les includes connus, 8 résolveurs) | vert |
| Pas de `localStorage`/`sessionStorage` (§4.2) | `web/tests/invariantes-rendu-html.test.ts` *(nouveau, balaie `app/`, `components/`, `lib/`)* | vert |
| Aucun HTML fabriqué à partir du contenu de la base (§8 point 8) | `web/tests/invariantes-rendu-html.test.ts` *(nouveau)* + rendu d'un `<img onerror>` dans une explication | vert |

## Régressions détectées

**Aucune.** Les 580 tests backend et 561 tests frontend antérieurs à cette passe
passent tous après l'étape 6 et après le correctif `205f521`. Les deux suites complètes
ont été rejouées intégralement (toutes les applications, pas seulement `assessment` et
`learning`) : `645 passed` et `619 passed`.

Un point mérite d'être noté sans être une régression : `apps/learning/services.py` a
changé de règle de déverrouillage (chapitres terminés **et** examen réussi). Le test
`test_un_module_sans_examen_deverrouille_le_suivant_comme_avant` vérifie explicitement
que le comportement de l'étape 5 est inchangé pour un module sans examen, et
`apps/learning/tests/test_services.py` (étape 5) reste vert sans modification.

## Tests rouges (= étape bloquée)

### R1 — `test_le_quiz_dune_formation_depubliee_nest_pas_servi` — **fuite de contenu, corrigée pendant la session**

**Sortie brute au moment de la découverte** (base `2b8bc4f`) :

```
_____________ test_le_quiz_dune_formation_depubliee_nest_pas_servi _____________

    def test_le_quiz_dune_formation_depubliee_nest_pas_servi(...) -> None:
        cours.is_published = False
        cours.save(update_fields=["is_published"])

>       assert client_etudiante.get(f"/api/quizzes/{quiz_chapitre.id}").status_code == 404
E       assert 200 == 404
E        +  where 200 = <Response status_code=200, "application/json">.status_code
E        +    where <Response status_code=200, "application/json"> = get('/api/quizzes/6')

apps/assessment/tests/test_cloisonnement.py:105: AssertionError
```

Corps réellement servi pour une formation **non publiée**, à un compte **sans aucune
inscription** :

```
statut = 200 / b'{"id":1,"kind":"chapitre","pass_threshold":60,"max_attempts":2,
"min_duration_s":5,"attempts_used":0,"attempts_remaining":2,"best_score":null,
"questions":[{"id":1,"order":1,"text":"Question 1 ?","choices":[…]}, …]}'
```

**Diagnostic : bug produit, pas défaut de test.** `apps.assessment.services.a_acces_au_quiz`
ne regardait que `chapter.is_free` et `a_acces_au_contenu`, jamais `course.is_published`
— seul point d'API de contenu du projet à l'oublier. Tous les autres le font :
`catalog/views.py:63` et `:93`, `learning/views.py:51` et `:81`, `media/services.py:77`.
Conséquence : les questions et les choix d'une formation encore en préparation
sortaient à n'importe quel compte authentifié qui devinait un identifiant (auto-incrément,
donc trivial), sans inscription ni paiement. Second test rouge sur la même racine :
`test_le_quiz_gratuit_dune_formation_depubliee_nest_pas_servi_sans_inscription`.

**État à la clôture : corrigé** dans `205f521` (`a_acces_au_quiz` refuse désormais les
deux branches, chapitre et module, quand `course.is_published` est faux). Les deux tests
sont verts et restent en place comme garde. La branche « examen de module » du correctif
n'était couverte par rien : `test_le_quiz_dune_formation_depubliee_nest_pas_servi` a été
étendu aux cinq appels (QCM gratuit, QCM payant, examen, et les deux démarrages de
tentative) pour la couvrir aussi.

### Défauts de test corrigés en cours de route (aucun impact produit)

- `bonnes_reponses()` de `conftest.py` lève `StopIteration` sur une question sans bonne
  réponse : mon premier test « question sans bonne réponse » l'utilisait à tort. Corrigé
  côté test (construction explicite des réponses), le service, lui, tolère bien ce cas.
- Un test de la page QCM listait `1e3` et `999999999999999999999999` parmi les
  identifiants « refusés sans appel serveur » : `Number.isInteger` les accepte, la page
  appelle donc Django, qui répond 404. Comportement acceptable, liste corrigée.

## Constats non bloquants relevés en écrivant les tests

Ni BLOQUANT ni CRITIQUE — signalés parce qu'ils ont une conséquence produit visible.

1. **MAJEUR (déjà relevé par la revue, confirmé par un test)** — un examen de module
   créé mais encore **vide de questions** note 0 à chaque soumission, donc `exam_passed`
   n'est jamais posé, donc le module suivant reste verrouillé pour toute la promo.
   `test_un_examen_encore_vide_verrouille_tout_le_reste_du_parcours` fixe ce
   comportement comme **test de caractérisation** (docstring explicite : il devra être
   réécrit si la règle est corrigée), pour que le défaut soit visible plutôt que
   théorique. `calculer_pipeline` protège l'examen *absent*, pas l'examen *vide*.
2. **MINEUR** — une question sans aucun `is_correct` est corrigible sans erreur mais
   inéchouable : `test_une_question_sans_bonne_reponse_est_comptee_fausse_sans_planter`
   (backend) et `une question sans bonne réponse en base n'affiche pas « undefined »`
   (frontend, affiche un tiret) prouvent que rien ne casse — mais rien n'empêche non
   plus la saisie fautive côté admin.
3. **MINEUR** — `soumettre_tentative` ne revérifie pas `a_acces_au_quiz` : une tentative
   ouverte alors que le compte était actif reste soumettable après passage en `BLOCKED`,
   et renvoie alors les corrections et explications. La création de tentative, elle, est
   bien barrée (`test_un_compte_bloque_perd_lacces_au_quiz_payant`), donc l'exploitation
   suppose un accès légitime préalable et ne révèle que des questions déjà servies.
4. **MINEUR** — `exam_quiz_id` est renvoyé dans le pipeline d'un compte `PENDING` alors
   que la porte au bout répond 404. Sans conséquence d'interface : `/app` n'affiche
   `Pipeline` que pour un compte `ACTIVE` (le compte non actif reste sur
   `ParcoursEtudiant`), donc aucun lien mort n'est proposé. Fixé par
   `test_un_compte_pending_ne_recoit_quun_pointeur_dexamen_jamais_son_contenu`, qui
   vérifie surtout qu'aucun contenu de QCM ne transite par cette route.
5. **MINEUR** — deux branches mortes et un état sans effet dans `Qcm.tsx` (tableau de la
   section Couverture).

## Verdict

**PORTE OUVERTE.**

Les cinq critères « Terminé quand » de l'étape 6 sont chacun couverts par au moins un
test dédié, et par plusieurs pour les points sensibles :

- [x] `is_correct` n'apparaît dans **aucune** réponse d'API avant soumission
      — `test_quiz_ne_revele_jamais_is_correct`,
        `test_aucune_reponse_anterieure_a_la_soumission_ne_porte_is_correct` (balaie
        aussi le démarrage de tentative),
        `test_aucune_reponse_anterieure_a_la_soumission_ne_porte_dexplication`,
        `test_etat_quiz_ne_porte_aucun_is_correct` (service),
        `tests/test_security_baseline.py` (introspection de tous les serializers),
        `lib-assessment` (le schéma Zod refuse le champ côté client).
- [x] Une soumission plus rapide que la durée plancher est rejetée
      — `test_soumettre_refuse_avant_la_duree_plancher`,
        `test_soumission_une_seconde_avant_le_plancher_est_refusee`,
        `test_soumission_a_la_seconde_exacte_du_plancher_est_acceptee`,
        `test_une_soumission_trop_rapide_ne_consomme_aucune_tentative_et_ne_note_rien`.
- [x] La limite de tentatives est appliquée côté serveur
      — `test_demarrer_tentative_refuse_au_dela_du_maximum`,
        `test_letat_du_quiz_dit_la_verite_sur_le_quota_et_le_meilleur_score`,
        `test_une_tentative_ouverte_ne_consomme_pas_le_quota`,
        `test_un_quiz_a_zero_tentative_refuse_des_la_premiere_demande`.
- [x] Un étudiant ne peut pas soumettre une tentative appartenant à un autre
      — `test_soumettre_dune_tentative_dun_autre_etudiant_renvoie_404`,
        `test_une_tentative_dun_tiers_est_indiscernable_dune_tentative_inexistante`,
        `test_la_tentative_dun_tiers_reste_intacte_apres_une_tentative_didor`,
        `test_letat_dun_quiz_ne_melange_jamais_les_tentatives_de_deux_comptes`,
        `test_un_examen_reussi_par_un_compte_ne_deverrouille_rien_pour_lautre`.
- [x] Le score ne peut pas être envoyé ni influencé depuis le client
      — `test_aucun_champ_du_corps_ninfluence_le_score_ni_le_verdict`,
        `test_aucun_champ_descalade_de_privilege_nest_accepte`,
        `test_le_demarrage_ignore_un_corps_forge`,
        `test_la_seconde_soumission_est_refusee_et_nefface_pas_la_premiere`,
        `le corps envoyé ne contient que \`answers\`` (frontend).

Aucun test n'est rouge à la clôture, aucun n'est marqué « skip », et les deux suites
complètes ont été rejouées en entier. La seule constatation qui aurait bloqué l'étape
(la fuite de contenu non publié) a été corrigée dans `205f521` et est désormais
verrouillée par deux tests.

**Réserve à porter au journal de l'étape** : le MAJEUR « examen vide » (constat 1) n'est
pas corrigé. Il ne bloque pas la porte de test — rien n'est cassé, tout est couvert —
mais il fera perdre le module suivant à toute la promo le jour où un examen sera créé
avant d'être rempli. C'est une décision produit, pas un défaut de test.

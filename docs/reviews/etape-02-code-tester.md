# Étape 02 — Rapport de test

**Date** : 2026-09-04
**Branche** : `etape-02-landing-chapitre-gratuit`
**Commits audités** : `3278688` (livraison de l'étape) puis `149e2f9` (correctifs de porte
+ tests QA), ce dernier étant l'état final vérifié et poussé
**Agent** : `code-tester` (CLAUDE.md §8, agent 2)

## Environnement

| Composant | Version |
|---|---|
| Python | 3.12.3 (venv `api/.venv`) |
| Django / DRF | 5.2.17 / 3.18.0 |
| PostgreSQL | 16.13 (base de test réelle, jamais SQLite) |
| Node / npm | 22.22.2 / 10.9.7 |
| Next.js | 15.5.25 |
| Vitest / Testing Library | 5.0.0 / React |

## Commandes exécutées

```
# Backend (depuis api/, venv activé, variables d'env de dev)
ruff check apps config
ruff format --check apps config
mypy apps config
pytest --cov=apps --cov=config --cov-branch --cov-report=term-missing -q
pytest --cov=apps.catalog --cov-branch --cov-report=term-missing -q apps/catalog

# Frontend (depuis web/)
npm run test:cov
npx tsc --noEmit
npx eslint .
NEXT_PUBLIC_SITE_URL=https://anis.dev API_INTERNAL_URL=http://127.0.0.1:8000 npx next build
npm run build | grep -E "○" | grep -E "/" | grep -vE "/icon\.svg|/robots\.txt|/sitemap\.xml"   # garde CI

# Intégration réelle (leçon de l'étape 0 : ne pas se contenter des tests unitaires)
python manage.py migrate && python manage.py seed_course
python manage.py runserver 127.0.0.1:8011 + curl sur les 3 endpoints publics
```

## Inventaire des unités introduites par l'étape

| Unité | Type | Couverte par |
|---|---|---|
| `GET /api/public/course/{slug}` | endpoint | `test_course_view`, `test_endpoints_limites`, `test_invariantes_catalogue` |
| `GET /api/public/chapters/{slug}` | endpoint | `test_chapter_view`, `test_endpoints_limites`, `test_invariantes_catalogue` |
| `POST /api/public/leads` | endpoint | `test_leads_view`, `test_endpoints_limites` |
| `services.creer_lead` | service | `test_services`, `test_endpoints_limites` |
| `seed_course` | commande | `test_seed_course`, `test_seed_course_limites` |
| Modèles `Course/Module/Chapter/Lesson/Lead` | modèles | `test_models`, `test_invariantes_catalogue` |
| `POST /api/public/leads` (BFF Next) | route handler | `leads-route`, `leads-route-limites` |
| `FormulaireListeAttente` | composant interactif | `composants-marketing`, `marketing-cas-limites` |
| `LecteurVideo` / `LecteurChapitreGratuit` | composants | `composants-marketing`, `marketing-cas-limites` |
| `Parcours` / `Tarifs` / `Faq` / `EnTeteMarketing` | composants | `composants-marketing`, `marketing-cas-limites` |
| Landing `/`, `/gratuit/[chapitre]` | pages SSR | `marketing-landing-page`, `gratuit-chapitre-page`, `invariantes-paywall-ssr` |
| `lib/catalog`, `catalog-schemas`, `markdown-leger`, `env-public`, `sitemap`, `robots` | libs | fichiers de test homonymes + `marketing-cas-limites` |

## Tests ajoutés

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `api/apps/catalog/tests/test_endpoints_limites.py` | Méthodes interdites (405) sur les 3 routes ; payloads invalides (champ manquant, corps vide, type faux, téléphone > 32) ; champs internes (`id`, `ip_prefix`, `created_at`) ignorés en entrée ; cas limites du délai plancher (valeur zéro, horloge client dans le futur, juste au-dessus du seuil) ; quota isolé par IP et consommé aussi par les bots ; 7 slugs hostiles (SQLi, XSS, traversée de chemin, slug de 300 caractères) → 404 sans 500 ni bavardage | 35 |
| `api/apps/catalog/tests/test_invariantes_catalogue.py` | Invariantes §4 rejouées sur des réponses HTTP réelles : compte `PENDING` limité au chapitre `is_free` ; exception au paywall pilotée par le flag et non par un identifiant ; aucune URL vidéo brute ni `is_correct` ni champ interne dans les réponses ; 404 indistinguables (payant vs inexistant, brouillon vs inexistant) ; Django ne pose aucun cookie lui-même ; ordre serveur des modules/chapitres ; dépublication qui referme le contenu ; chapitre gratuit sans leçon → 200, pas 500 | 11 |
| `api/apps/catalog/tests/test_seed_course_limites.py` | `seed_course` comme transition d'état : message de sortie, rejeu qui répare un contenu modifié à la main, rejeu qui ne détruit pas une vidéo déjà déposée, un seul chapitre gratuit, structure réelle (pas de lorem ipsum), **atomicité** (échec en milieu de commande → aucune trace), rejeu propre après échec | 8 |
| `web/tests/marketing-cas-limites.test.tsx` | `FormulaireListeAttente` : message actionnable sur 400, état de chargement (bouton désactivé + « Envoi… »), effacement de l'erreur précédente, soumission clavier, champs accessibles sans `tabindex` piégé, horodatage figé au montage, honeypot relayé sans signal au bot. `LecteurChapitreGratuit` : HTML hostile échappé (XSS stocké), transcript vide, **aucune URL `.mp4` fabriquée même avec un `video_provider_id`**. `Parcours` : module vide, formation sans module, opacité 45 % sans gating dur, ordre serveur. `analyserTranscript` : `###`, langage de bloc, indentation, bloc non refermé | 19 |
| `web/tests/leads-route-limites.test.ts` | BFF : 400 de Django traduit sans relayer son corps brut, corps non-JSON / vide / tableau / null refusés sans appeler Django, champs `is_staff`/`role`/`status`/`id` jamais relayés, valeurs par défaut des champs facultatifs, chaîne `X-Forwarded-For` réduite à l'IP d'origine, repli `x-real-ip` puis IP vide, aucune donnée du visiteur ni cookie en réponse | 10 |
| `web/tests/invariantes-paywall-ssr.test.ts` | Le HTML du SSR ne contient ni transcript ni identifiant vidéo d'un chapitre payant ; un seul chapitre demandé (§4.4) ; `/gratuit/[chapitre]` en 404 sur un slug payant sans afficher son titre ; le hero suit le flag `is_free` ; formation entièrement payante → aucun contenu demandé ; JSON-LD sans contenu de leçon | 7 |

**Total ajouté : 90 cas** (54 backend, 36 frontend).

## Résultats

### Backend — suite complète (étapes 0, 1 et 2)

```
254 passed in 16.20s

Name                                              Stmts   Miss Branch BrPart  Cover
apps/accounts/... (14 modules)                      ...      0    ...      0   100%
apps/catalog/admin.py                                29      0      0      0   100%
apps/catalog/management/commands/seed_course.py      24      0      2      0   100%
apps/catalog/models.py                               52      0      0      0   100%
apps/catalog/serializers.py                          42      0      0      0   100%
apps/catalog/services.py                             14      0      4      0   100%
apps/catalog/urls.py                                  4      0      0      0   100%
apps/catalog/views.py                                50      0      2      0   100%
config/... (9 modules)                              ...      0      6      0   100%
TOTAL                                               836      0     58      0   100%
```

`ruff check` : *All checks passed!* · `ruff format --check` : *80 files already formatted* ·
`mypy --strict` : *Success: no issues found in 80 source files*.

### Frontend — suite complète

```
 Test Files  24 passed (24)
      Tests  263 passed (263)

File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
All files          |   99.57 |    99.17 |   97.43 |     100 |
 ...-reset/confirm |   92.85 |      100 |      50 |     100 |
 ...omponents/auth |   99.09 |      100 |   92.85 |     100 |
 web/lib           |     100 |    96.55 |     100 |     100 |
  api.ts           |     100 |       90 |     100 |     100 | 47
  client-ip.ts     |     100 |    83.33 |     100 |     100 | 7
Statements   : 99.57% ( 471/473 )
Branches     : 99.17% ( 240/242 )
Functions    : 97.43% ( 76/78 )
Lines        : 100% ( 448/448 )
```

`tsc --noEmit` : vert · `eslint .` : vert · `next build` : vert.

**Aucune route HTML n'est prérendue en statique** (toutes marquées `ƒ`) : la garde CI de
l'étape 0 sur la CSP à nonce tient toujours, y compris pour `/` et `/gratuit/[chapitre]`.
Seuls `/icon.svg`, `/robots.txt` et `/sitemap.xml` sont statiques — ce sont des routes de
métadonnées sans `<script>`, l'exclusion ajoutée à la CI par cette étape est justifiée, et
je l'ai rejouée telle quelle sur la sortie de build : elle ne matche rien.

### Intégration réelle (serveur lancé, base semée, curl)

```
--- COURS ---            200, arbre sans aucun contenu de leçon
--- CHAPITRE GRATUIT --- 200, transcript complet, "video_provider_id":""
--- CHAPITRE PAYANT ---  {"detail":"Non trouvé."}   HTTP 404
--- CHAPITRE INEXISTANT  {"detail":"Non trouvé."}   HTTP 404
--- LEAD LEGITIME ---    201 {"detail":"Inscrit à la liste d'attente."}
--- BOT (honeypot) ---   201 {"detail":"Inscrit à la liste d'attente."}   (rien en base)
--- TROP RAPIDE ---      201 {"detail":"Inscrit à la liste d'attente."}   (rien en base)
--- RATE LIMIT ---       201 201 201 201 201 429
--- LOGS ---             0 occurrence de password/token/secret
```

## Couverture

| Module de l'étape | Stmts | Branch | Lignes non couvertes |
|---|---|---|---|
| `apps/catalog/models.py` | 100 % | 100 % | — |
| `apps/catalog/serializers.py` | 100 % | 100 % | — |
| `apps/catalog/services.py` | 100 % | 100 % | — |
| `apps/catalog/views.py` | 100 % | 100 % | — |
| `apps/catalog/admin.py` | 100 % | 100 % | — |
| `apps/catalog/management/commands/seed_course.py` | 100 % | 100 % | — |
| `web/app/(marketing)/page.tsx` | 100 % | 100 % | — |
| `web/app/gratuit/[chapitre]/page.tsx` | 100 % | 100 % | — |
| `web/app/api/public/leads/route.ts` | 100 % | 100 % | — (était 86,66 % / 92,85 %, ligne 45) |
| `web/components/marketing/*` | 100 % | 100 % | — (était 93,75 % / 87,5 %) |
| `web/lib/catalog.ts`, `catalog-schemas.ts`, `markdown-leger.ts`, `env-public.ts` | 100 % | 100 % | — |
| `web/app/sitemap.ts`, `robots.ts` | 100 % | 100 % | — |

**Le code de l'étape 2 est à 100 % d'instructions et de branches**, largement au-dessus de
la cible de 80 %. Les chiffres annoncés par le développeur (backend 100 %, frontend 98,5 %)
sont confirmés ; les 1,5 % manquants côté front étaient bien du code de l'étape 2
(`leads/route.ts` ligne 45, `FormulaireListeAttente` lignes 34-35 et 60, branches de
`Parcours` et `LecteurChapitreGratuit`) et sont désormais couverts.

Lignes non couvertes résiduelles, **toutes antérieures à l'étape 2** :

| Fichier | Ligne | Pourquoi |
|---|---|---|
| `app/api/auth/password-reset/confirm/route.ts` | — | 50 % de fonctions : le handler `GET` de repli n'est pas appelé (étape 1) |
| `components/auth/ChampMotDePasse.tsx` | — | bascule d'affichage du mot de passe non simulée (étape 1) |
| `lib/api.ts` | 47 | branche `acceptStatuses?.` quand l'option est absente **et** le statut non-2xx (étape 1) |
| `lib/client-ip.ts` | 7 | `xff.split(",")[0]?.trim() ?? ""` — le repli `?? ""` est inatteignable : `split` renvoie toujours au moins un élément |

## Régressions détectées

**Aucune.** Les 200 tests backend et 227 tests frontend des étapes 0 et 1 passent
intégralement après l'étape 2 et après l'ajout de mes 90 cas. Deux points de vigilance
levés explicitement :

- la sentinelle `test_un_compte_pending_n_a_encore_acces_a_aucun_contenu`
  (`apps/accounts/tests/test_invariantes.py`) reste verte, mais elle ne prouve plus
  grand-chose maintenant que le catalogue existe : elle interroge `/api/public/chapters/1`,
  un slug qui n'existe pas. La version réelle de cette invariante est désormais dans
  `test_invariantes_catalogue.py::test_un_compte_pending_n_obtient_que_le_chapitre_gratuit`,
  qui crée un vrai chapitre payant et un vrai compte connecté ;
- `tests/design-tokens.test.ts` et `lib/design-tokens.ts` ont été supprimés par l'étape
  (la page de référence du §6 devait disparaître à l'étape 2, conformément à `progress.md`).
  Ce n'est pas une régression de couverture : le code testé n'existe plus.

## Tests rouges rencontrés pendant l'audit

Les trois constatations ci-dessous ont toutes été **rouges sur le commit de livraison
`3278688`**. Elles sont corrigées et vérifiées vertes sur `149e2f9`. Je les conserve ici
avec leur sortie brute : ce sont elles qui justifient les tests ajoutés, et ce sont elles
qui empêcheront la régression.

### 1. Le corps du 404 distinguait un chapitre existant d'un chapitre inexistant — **bug produit**

Constaté sur le commit poussé `3278688`, par deux tests que j'ai ajoutés :

```
FAILED apps/catalog/tests/test_invariantes_catalogue.py::
       test_le_404_d_un_chapitre_payant_est_identique_a_celui_d_un_chapitre_inexistant
FAILED apps/catalog/tests/test_invariantes_catalogue.py::
       test_le_404_d_un_chapitre_de_cours_non_publie_est_identique_a_celui_d_un_inexistant

E       AssertionError: le corps du 404 distingue un slug existant d'un slug inexistant :
                        un brouillon devient énumérable
E       assert {'detail': 'Non trouvé.'} == {'detail': 'N...given query.'}
E         Differing items:
E         {'detail': 'Non trouvé.'} != {'detail': 'No Chapter matches the given query.'}
```

Reproduit hors pytest, **avec `DEBUG = False`** (donc ce n'était pas un artefact de dev) :

```
EXISTANT: 404 {"detail":"Non trouvé."}
FANTOME : 404 {"detail":"No Chapter matches the given query."}
```

**Diagnostic.** `ChapterPublicDetailView` utilisait `get_object_or_404`, qui lève un
`Http404` *portant un message construit à partir du modèle*. DRF recopie ce message dans
la réponse. Le `raise Http404` nu du contrôle `is_free` produisait au contraire le message
générique de DRF. Résultat : deux corps différents pour deux 404, exactement l'oracle que
CLAUDE.md §4.3 interdit (« 404, pas 403 — ne pas confirmer l'existence »). Le cas
d'exploitation réel n'est pas le chapitre payant d'un cours publié (son slug est de toute
façon dans l'arbre public, c'est l'argument de vente), mais le **chapitre d'un cours en
préparation** : la différence de message permettait d'énumérer les brouillons. En prime, le
message livrait le nom interne du modèle (`Chapter`) au client.

**État actuel.** Corrigé dans `149e2f9` (`api/apps/catalog/views.py` : `get_object_or_404`
remplacé par un `.get()` + `raise Http404 from None` sur les deux vues). Les deux tests
sont verts, et je l'ai revérifié sur serveur réel (voir §Intégration : les deux corps sont
identiques bit pour bit).

### 2. Le front fabriquait une URL de fichier `.mp4` — **bug produit, invariante §4.1.1**

Constaté également sur `3278688` :

```tsx
// web/components/marketing/LecteurChapitreGratuit.tsx (état poussé)
<LecteurVideo
  src={chapitre.lesson.video_provider_id ? `/videos/${chapitre.lesson.video_provider_id}.mp4` : null}
```

Rendu observé avec un identifiant renseigné :

```
<video src="/videos/12345-abcde.mp4" controls controlsList="nodownload" ...>
```

**Diagnostic.** L'invariante « aucune réponse d'API ne contient d'URL de fichier vidéo
brute » est respectée côté Django (l'API renvoie un identifiant, pas une URL) — mes tests
backend le confirment. Mais le composant **reconstituait** une URL de fichier non signée à
partir de cet identifiant, vers un chemin `/videos/` qui n'existe même pas dans `web/`.
Latent tant que le seed laisse `video_provider_id` vide, mais amorcé pour exploser à
l'étape 4, où c'est précisément le chemin que §4.1 interdit.

**État actuel.** Corrigé dans `149e2f9` : `src={null}` en dur, avec un commentaire
renvoyant à l'étape 4. Mon test
`marketing-cas-limites.test.tsx::ne fabrique jamais d'URL de fichier vidéo…` verrouille
l'invariante pour l'avenir : il échouera à la seconde où le composant redérivera une source
depuis `video_provider_id`.

### 3. Le hero dépendait d'un slug écrit en dur — **bug produit, §4.4**

`app/(marketing)/page.tsx` appelait
`recupererChapitreGratuit("installer-flutter-et-configurer-ton-editeur")`. CLAUDE.md §4.4
est explicite : l'exception au paywall « est définie par un flag `is_free` en base, pas par
un id codé en dur ». Aucune fuite de contenu, mais un renommage de slug faisait diverger le
hero et le parcours affiché juste en dessous. **Corrigé dans `149e2f9`** : le slug est
désormais dérivé du premier chapitre `is_free` de l'arbre. Deux de
mes tests couvrent le nouveau comportement, dont le cas limite « aucun chapitre gratuit ».

## Observations sans test rouge

- **MINEUR — perte silencieuse de contenu dans `markdown-leger.ts`.** Un bloc ` ``` `
  ouvert et jamais refermé fait disparaître toute la fin du chapitre, sans erreur.
  Sans conséquence de sécurité (le contenu vient du seed), mais à traiter quand la saisie
  passera par le back-office (étape 7). Comportement figé par un test qui le documente.
- **MINEUR — `Lead.phone` accepte n'importe quel texte de 32 caractères**, y compris
  `<script>alert(1)</script>@@@` (observé en base après le passage d'un autre agent).
  Aucun rendu ne l'affiche aujourd'hui, et l'admin Django échappe automatiquement. À
  valider (format téléphone algérien) avant de l'afficher où que ce soit.
- **Le quota de la liste d'attente est de 5/h/IP** et compte aussi les soumissions
  recalées par le honeypot — c'est le bon choix, testé explicitement (sinon un bot aurait
  un quota illimité).

## Note de méthode

Un autre agent a modifié le code de production (`api/apps/catalog/views.py`,
`web/components/marketing/*`, `web/app/(marketing)/page.tsx`, la migration
`0001_initial.py`) **pendant** l'exécution de mes suites : une même assertion a réussi puis
échoué à quelques minutes d'intervalle. Je n'ai touché à aucun fichier de production ;
tous les chiffres et sorties de ce rapport ont été **rejoués intégralement** sur l'arbre
final, puis une dernière fois après que ces modifications ont été commitées (`149e2f9`,
`git diff HEAD` vide hors ce rapport). Deux leçons pour les étapes suivantes : ne jamais
conclure sur des chiffres collectés avant la dernière modification du code, et se méfier
d'un test qui passe puis échoue sans qu'on ait touché au test.

## Verdict

**PORTE OUVERTE.**

Sur `149e2f9`, état final commité et poussé de la branche : **517 tests verts** — 254
backend (`pytest`, 100 % d'instructions **et** de branches sur `apps` + `config`) et 263
frontend (`vitest`, 100 % des lignes, 99,17 % des branches globales, **100 % sur chaque
fichier introduit par l'étape 2**). `ruff`, `ruff format`, `mypy --strict`, `tsc --noEmit`,
`eslint` et `next build` sont verts, aucune route HTML n'est prérendue en statique, et le
parcours d'intégration de `progress.md` a été rejoué sur un serveur réel : le chapitre
gratuit se lit sans compte, un chapitre payant renvoie un 404 rigoureusement indiscernable
d'un slug inexistant, la liste d'attente accepte l'humain, avale le bot en silence et
plafonne à 5/h/IP.

La porte était fermée au premier passage (deux tests d'invariante rouges sur le commit de
livraison `3278688` : oracle d'énumération sur le corps du 404, et URL `.mp4` fabriquée
côté client en violation de §4.1.1). Les correctifs ont été apportés par un autre agent
pendant l'audit, puis commités ; je les ai revérifiés de bout en bout sur l'état final.
Il ne reste aucun test rouge, et les deux invariantes sont désormais verrouillées par des
tests qui échoueront à la première régression.

Reste ouvert, sans blocage : deux MINEUR documentés ci-dessus (perte silencieuse d'un bloc
de code non refermé dans `markdown-leger.ts` ; `Lead.phone` sans validation de format), et
le critère « Lighthouse mobile ≥ 90 perf et a11y » de `progress.md`, qui n'est pas du
ressort de cet agent et n'a pas été mesuré ici.

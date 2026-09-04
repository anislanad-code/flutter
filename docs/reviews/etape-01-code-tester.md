# Étape 01 — Rapport de test

**Date** : 2026-09-04
**Commit de référence** : `7451b90` (« sec: corriger l'oracle d'énumération au register et le
contraste AA (porte étape 1) ») — succède à `9c655bc` et `95c9885`.
**Branche** : `claude/lancer-etape-1-7cwnnz`

## Environnement

| Élément | Version |
|---|---|
| Python | 3.12.3 (venv `api/.venv`) |
| Django | 5.2.17 |
| Django REST Framework | 3.18.0 |
| PostgreSQL | 16.13 (cluster système, `127.0.0.1:5432`, base `anisdev`) — **base réelle, pas SQLite** |
| Node | 22.22.2 · npm 10.9.7 |
| Next.js | 15.5.25 |
| Vitest | 5.0.0 (+ `@vitest/coverage-v8`) |
| Ajouts de l'outillage de test | `@testing-library/react` 16.3.3, `@testing-library/user-event` 14.6.7, `@testing-library/dom` 10.4.1, `jsdom` 30.0.1 (devDependencies) |

### Commandes exécutées

```bash
# Backend, depuis api/
. .venv/bin/activate
export DJANGO_SECRET_KEY=test-key POSTGRES_DB=anisdev POSTGRES_USER=anisdev \
       POSTGRES_PASSWORD=anisdev POSTGRES_HOST=127.0.0.1 \
       DJANGO_SETTINGS_MODULE=config.settings.dev \
       DJANGO_ALLOWED_HOSTS=localhost,testserver \
       DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:3000 \
       DJANGO_CSRF_TRUSTED_ORIGINS=http://localhost:3000
pytest --cov=apps --cov=config --cov-report=term-missing --cov-fail-under=80
ruff check . && ruff format --check . && mypy apps config

# Frontend, depuis web/
npm run test:cov
npm run lint
npm run typecheck
API_INTERNAL_URL=http://localhost:8000 npm run build
```

---

## Remarque préalable — l'arbre a bougé pendant la campagne

Pendant l'exécution de cette campagne, un autre agent a appliqué les correctifs des rapports
`etape-01-security-tester.md` et `etape-01-code-reviewer.md` puis a committé (`7451b90`). Deux
changements de production touchaient directement mes tests :

1. `MeSerializer` ne renvoie plus `flagged_for_review`, et `utilisateurSchema` (Zod) ne l'attend
   plus. Deux tests sont passés au rouge sur cet écart avant que le correctif ne soit complet.
2. `POST /api/auth/register` ne connecte plus automatiquement (oracle d'énumération) : le
   formulaire d'inscription enchaîne désormais un vrai `POST /api/auth/login`.

**Tous les chiffres et sorties de ce rapport ont été reproduits après stabilisation de l'arbre,
sur `7451b90` + mes deux derniers fichiers de test.** Les deux rouges transitoires sont
documentés plus bas ; ils sont fermés.

---

## Tests ajoutés

### Backend — `api/apps/accounts/tests/`

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `test_modeles.py` (nouveau) | Les `__str__` de `User`, `Session`, `PasswordResetToken`, `Enrollment` ne laissent fuiter ni mot de passe, ni hachage de refresh, ni hachage de jeton de reset (ils s'affichent dans l'admin Django). Identifiants de `Session` et `PasswordResetToken` en UUID (pas d'énumération). `is_valid()` couvert sur ses trois cas (valide / expiré / révoqué ou consommé). Unicité de l'email au niveau base. | 7 |
| `test_invariantes.py` (nouveau) | Les invariantes du §4 rejouées même si l'étape n'y touche pas : aucun `is_correct` dans un serializer ou une vue ; aucune URL de fichier vidéo (`.mp4`, `.m3u8`, `b-cdn.net`…) dans un serializer ou une vue ; **inspection de la table de routage complète** (récursive, pas des noms devinés) pour prouver qu'aucune route ne permet de définir le mot de passe d'un tiers ; `/api/me` n'expose ni `password`, ni `flagged_for_review`, ni `is_superuser`, ni `groups`, ni un hachage ; un compte `PENDING` reçoit 404 sur toutes les routes de contenu à venir. | 5 |

Les 164 tests backend déjà présents (`test_register`, `test_login`, `test_refresh`, `test_logout`,
`test_password_reset`, `test_securite`, `test_authentication`, `test_endpoints_limites`,
`test_managers`, `test_services`, `test_tokens`, `test_utils`) ont été relus : ils couvrent bien,
pour chaque endpoint, le chemin nominal, le non-authentifié, le payload invalide, la limite de
tentatives et l'égalité de réponse compte connu / inconnu. Je n'ai rien réécrit.

### Frontend — `web/tests/`

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `composants-auth.test.tsx` (nouveau) | Les 6 composants de `components/auth/` étaient à **0 %**. Pour chacun : rendu, saisie valide, saisie invalide avec message rattaché au champ (`aria-invalid` + `aria-describedby`), état de chargement (bouton désactivé + libellé), état d'erreur (401 / 429 / 500 / réseau), **navigation clavier complète** (ordre de tabulation vérifié champ par champ, envoi par `Entrée`). Cas de sécurité : `?suite=https://evil.example` est ignoré au profit de `/app` (pas de redirection ouverte) ; le formulaire « mot de passe oublié » affiche exactement la même confirmation qu'un email soit connu, inconnu ou que l'API tombe ; l'inscription enchaîne bien `register` puis `login` et, sur échec de connexion, dit « Compte créé. Connecte-toi pour continuer. » sans jamais employer « existe », « déjà » ou « pris ». | 40 |
| `pages-auth.test.tsx` (nouveau) | Les pages `(auth)`, `(student)/app` et `(admin)/admin` étaient à **0 %**. Rendu des 4 pages publiques + layout ; `/app` sans session → `redirect("/connexion?suite=/app")` ; `/admin` sans session → `/connexion?suite=/admin` ; **`/admin` avec une session valide mais `is_staff: false` → `/app`, aucun contenu admin rendu** ; les deux pages protégées sont en `force-dynamic` (jamais de HTML de session prérendu) ; `/admin` porte `robots: { index: false }`. | 13 |
| `lib-current-user.test.ts` (nouveau) | `lib/current-user.ts` était à **0 %** — c'est la porte d'entrée de tous les Server Components protégés. Cookie absent → aucun appel réseau ; 401 → `null` ; API injoignable → `null` ; réponse hors schéma Zod → `null` (`is_staff` manquant, `is_staff: "true"` en chaîne — pas de coercition, corps `null`) ; cookie vide traité comme absence de session. | 8 |
| `auth-routes-degrade.test.ts` (nouveau) | Chemins dégradés des Route Handlers, non couverts jusque-là. Django injoignable → 503 générique sur `login`, `register`, `refresh`, `password-reset/confirm`, `/api/me`, **sans poser de cookie** et **sans effacer les cookies existants au refresh** (une panne réseau ne doit pas déconnecter tout le monde). Réponse hors schéma → 502 **sans écrire de cookie d'authentification**, alors même que le corps contient un `access_token`. Corps de requête invalide → pas d'appel à Django du tout. Escalade de privilèges : `is_staff`, `status`, `enrollment_status` envoyés au BFF sont **supprimés** par Zod avant relais à Django. | 17 |
| `invariantes-cookies.test.ts` (nouveau) | Invariante §4.2 vérifiée sur le **`Set-Cookie` réellement sérialisé**, pas sur l'objet d'options : `HttpOnly`, `Secure`, `SameSite=strict`, `Path=/` sur les deux cookies en production ; `Secure` retombe hors production, le reste tient ; `Max-Age` = 900 / 604800 ; aucun token brut dans le corps JSON de `/api/auth/login` ; `effacerCookiesAuth` vide bien les deux cookies. Plus un balayage de tout `app/`, `components/`, `lib/` : **aucun fichier n'écrit dans `localStorage`, `sessionStorage` ou `document.cookie`**. | 6 |
| `layout.test.ts`, `lib-client-ip.test.ts` (complétés) | Rendu du layout sans en-tête `x-nonce` ; `X-Forwarded-For` vide ou dégénéré. | +3 |

---

## Résultats

### Backend — sortie brute

```
$ pytest --cov=apps --cov=config --cov-report=term-missing --cov-fail-under=80

........................................................................ [ 40%]
........................................................................ [ 81%]
................................                                         [100%]

---------- coverage: platform linux, python 3.12.3-final-0 -----------
Name                              Stmts   Miss  Cover   Missing
---------------------------------------------------------------
apps/accounts/admin.py               15      0   100%
apps/accounts/authentication.py      25      0   100%
apps/accounts/emails.py               9      0   100%
apps/accounts/managers.py            25      0   100%
apps/accounts/models.py              51      0   100%
apps/accounts/serializers.py         24      0   100%
apps/accounts/services.py           116      0   100%
apps/accounts/throttling.py          15      0   100%
apps/accounts/tokens.py              42      0   100%
apps/accounts/urls.py                 4      0   100%
apps/accounts/utils.py               16      0   100%
apps/accounts/views.py              125      0   100%
apps/enrollment/models.py            18      0   100%
config/health.py                     19      0   100%
config/settings/base.py              49      0   100%
config/settings/dev.py                6      0   100%
config/settings/prod.py              16      0   100%
config/urls.py                        6      0   100%
---------------------------------------------------------------
TOTAL                               621      0   100%

Required test coverage of 80% reached. Total coverage: 100.00%

============================= 176 passed in 22.36s =============================
```

Qualité statique backend :

```
$ ruff check .           → All checks passed!
$ ruff format --check .  → 66 files already formatted
$ mypy apps config       → Success: no issues found in 61 source files
```

### Frontend — sortie brute

```
$ npm run test:cov

 Test Files  15 passed (15)
      Tests  216 passed (216)
   Duration  4.45s

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   99.38 |    99.39 |   96.07 |     100 |
 ...-reset/confirm |   92.85 |      100 |      50 |     100 |
  route.ts         |   92.85 |      100 |      50 |     100 |
 ...omponents/auth |   99.07 |      100 |   92.85 |     100 |
  ...otDePasse.tsx |   96.15 |      100 |   66.66 |     100 |
 web/lib           |     100 |    96.15 |     100 |     100 |
  client-ip.ts     |     100 |    83.33 |     100 |     100 | 7
-------------------|---------|----------|---------|---------|-------------------

Statements   : 99.38% ( 322/324 )
Branches     : 99.39% ( 163/164 )
Functions    : 96.07% ( 49/51 )
Lines        : 100% ( 307/307 )
```

```
$ npm run lint       → eslint . (aucune erreur, aucun avertissement)
$ npm run typecheck  → tsc --noEmit (aucune erreur)
```

### Build de production Next

Leçon de l'étape 0 (« vérifier en `next dev` ne prouve rien ») appliquée :

```
$ API_INTERNAL_URL=http://localhost:8000 npm run build
 ✓ Compiled successfully in 2.8s
 ✓ Generating static pages (9/9)

Route (app)                                 Size  First Load JS
┌ ƒ /                                      149 B         103 kB
├ ƒ /admin                                 574 B         103 kB
├ ƒ /api/auth/login … /api/me               ƒ  (toutes dynamiques)
├ ƒ /app                                   574 B         103 kB
├ ƒ /connexion                           1.32 kB         104 kB
├ ○ /icon.svg                                0 B            0 B
├ ƒ /inscription                          1.4 kB         104 kB
├ ƒ /mot-de-passe-oublie                 1.05 kB         104 kB
└ ƒ /nouveau-mot-de-passe                1.43 kB         104 kB
ƒ Middleware                             34.3 kB
```

**Aucune route prérendue en statique sauf `/icon.svg`.** En particulier `/app`, `/admin`, et les
quatre pages d'auth sont toutes en `ƒ` (rendu à la demande) : aucun HTML de session n'est figé au
build, et le nonce de CSP est bien lu par requête.

---

## Couverture

### Backend — code introduit par l'étape

| Module | Stmts | Manquants | Couverture |
|---|---|---|---|
| `apps/accounts/models.py` | 51 | 0 | 100 % |
| `apps/accounts/services.py` | 116 | 0 | 100 % |
| `apps/accounts/views.py` | 125 | 0 | 100 % |
| `apps/accounts/tokens.py` | 42 | 0 | 100 % |
| `apps/accounts/authentication.py` | 25 | 0 | 100 % |
| `apps/accounts/serializers.py` | 24 | 0 | 100 % |
| `apps/accounts/managers.py` | 25 | 0 | 100 % |
| `apps/accounts/throttling.py` | 15 | 0 | 100 % |
| `apps/accounts/utils.py` | 16 | 0 | 100 % |
| `apps/accounts/emails.py` | 9 | 0 | 100 % |
| `apps/accounts/admin.py` | 15 | 0 | 100 % |
| `apps/enrollment/models.py` | 18 | 0 | 100 % |
| **Total `apps` + `config`** | **621** | **0** | **100 %** |

Les 4 lignes qui manquaient au début de la campagne (`accounts/models.py` 41, 66, 88 et
`enrollment/models.py` 33 — les quatre `__str__`) sont fermées par `test_modeles.py`. La cible de
80 % sur le code de l'étape est **largement** dépassée.

### Frontend

100 % des lignes. Les trois écarts résiduels, tous non significatifs :

| Fichier | Écart | Pourquoi |
|---|---|---|
| `app/api/auth/password-reset/confirm/route.ts` | 92,85 % stmts / 50 % funcs | Le corps de l'arrow `() => ({})` du `.catch()` sur `response.json()` n'est jamais exécuté (le mock d'`apiFetch` court-circuite le parsing). Toutes les **lignes** et **branches** du handler sont couvertes. |
| `components/auth/FormulaireNouveauMotDePasse.tsx` | 66,66 % funcs | Même cause : l'arrow du `.catch(() => ({}))` sur un corps JSON toujours valide dans les tests. Lignes et branches à 100 %. |
| `lib/client-ip.ts` ligne 7 | 83,33 % branch | Branche `?? ""` derrière `xff.split(",")[0]?` : `String.split` ne renvoie jamais un tableau vide, la branche est **inatteignable**. Défense en profondeur du code, pas un trou de test. |

### Trou signalé et refermé

Le rapport de la session précédente signalait un trou accepté : « les composants React sous
`web/components/auth/` et les pages sous `web/app/(auth)/`, `(student)/app/`, `(admin)/admin/`
sont à 0 % de couverture — React Testing Library n'est pas installé ».

**Ce trou est fermé.** RTL + `user-event` + `jsdom` ont été ajoutés en devDependencies (outillage
de test uniquement, aucun code de production touché), et les 6 composants + 7 pages/layouts sont
désormais couverts : 61 nouveaux cas front, dont la navigation clavier complète et la garde
`is_staff` de `/admin` — qui n'était vérifiée nulle part avant.

Ce n'était pas cosmétique : la couverture globale du front est passée de **54,32 % à 99,38 %** de
statements, et le contrôle « `/admin` avec un compte non-staff renvoie vers `/app` » n'existait
dans aucun test, ni côté Django, ni côté middleware.

---

## Régressions détectées

Suite complète des étapes précédentes rejouée : sonde `/api/health` (`config/health.py`), settings
`base`/`dev`/`prod`, routage `config/urls.py`, tokens de design `styles/tokens.css`, layout racine
et nonce de CSP, middleware. **Aucune régression.**

- `config/health.py`, `config/settings/*`, `config/urls.py` : toujours 100 %.
- `tests/design-tokens.test.ts`, `tests/marketing-page.test.ts`, `tests/middleware.test.ts`,
  `tests/health-route.test.ts`, `tests/lib-api.test.ts`, `tests/lib-env.test.ts` : verts.
- La leçon n° 2 de l'étape 0 (CSP à nonce + prérendu statique) tient toujours : le `next build`
  ci-dessus confirme qu'aucune page hors `/icon.svg` n'est statique.

---

## Tests rouges (= étape bloquée)

**Aucun test rouge à la clôture.** Trois rouges ont été rencontrés pendant la campagne, tous
fermés :

### 1. `Response constructor: Invalid response status code 204` (test à corriger — fermé)

```
FAIL tests/composants-auth.test.tsx > BoutonDeconnexion > chemin nominal
TypeError: Response constructor: Invalid response status code 204
 ❯ reponse tests/composants-auth.test.tsx:40:10
```

**Diagnostic : bug de test, pas de produit.** Mon helper construisait un `Response` 204 avec un
corps, ce qu'interdit la spec Fetch. Corrigé (corps `null` pour 204/205/304).

### 2. `flagged_for_review` disparu du schéma (course transitoire — fermé)

```
FAIL tests/auth-routes.test.ts > GET /api/me > renvoie le profil quand la session est valide
AssertionError: expected { id: 1, …(5) } to deeply equal { id: 1, …(6) }
-   "flagged_for_review": false,
```

**Diagnostic : ni bug produit ni bug de test — une course.** Un agent parallèle retirait
`flagged_for_review` de `MeSerializer` et de `utilisateurSchema` (bonne décision : c'est un signal
interne à l'admin, §4.1.6) pendant que ma suite tournait. Après stabilisation et commit `7451b90`,
les deux tests sont verts. J'ai vérifié la cohérence de bout en bout : Django ne l'émet plus, Zod
ne l'attend plus, et `test_invariantes.py::test_me_ne_renvoie_aucun_champ_interne` verrouille
désormais son absence.

### 3. Deux promesses non gérées sur coupure réseau (constat MINEUR — conservé, non bloquant)

```
⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
TypeError: Failed to fetch
 ❯ tests/composants-auth.test.tsx:342:33  (FormulaireMotDePasseOublie)
 ❯ tests/composants-auth.test.tsx:480:33  (BoutonDeconnexion)
```

**Diagnostic : petit défaut de produit, réel mais sans impact fonctionnel.**
`FormulaireMotDePasseOublie.envoyer()` et `BoutonDeconnexion.deconnecter()` utilisent
`try { await fetch(...) } finally { ... }` **sans `catch`**. Si `fetch` rejette (réseau coupé,
avion, tunnel), la promesse retournée par le gestionnaire d'événement rejette sans personne pour
l'attraper → `unhandledrejection` dans le navigateur.

L'affichage reste **correct** : le `finally` s'exécute, la confirmation neutre s'affiche, la
redirection vers `/connexion` a lieu. Les deux autres formulaires (`Connexion`, `Inscription`,
`NouveauMotDePasse`) ont bien un `catch`.

Je **ne corrige pas le code de production** (hors de mon périmètre). Je n'ai pas non plus laissé le
test rouge : le tester ferait échouer la suite sur l'« unhandled rejection » elle-même, ce qui
transformerait un MINEUR en blocage. J'ai couvert à la place l'échec serveur (500), qui ne rejette
pas, et commenté explicitement les deux emplacements dans le fichier de test.

**À reprendre par `code-reviewer` / à corriger en une ligne** : ajouter
`catch { /* même issue */ }` à côté du `finally` dans ces deux composants.

---

## Points de sécurité vérifiés par les tests (rappel des invariantes §4)

| Invariante | Où c'est prouvé | État |
|---|---|---|
| Un serializer de `Choice` ne sérialise jamais `is_correct` | `test_invariantes.py` (sentinelle, `Choice` n'existe pas encore) | vert |
| Aucune réponse d'API ne contient d'URL de fichier vidéo brute | `test_invariantes.py` (sentinelle) | vert |
| Un compte `PENDING` n'obtient que le chapitre `is_free` | `test_invariantes.py` (sentinelle : 404 sur toutes les routes de contenu à venir) | vert |
| Cookies d'auth `httpOnly` + `Secure` + `SameSite=Strict` | `invariantes-cookies.test.ts` (sur le `Set-Cookie` sérialisé) | vert |
| Aucune route ne permet de définir le mot de passe d'un tiers | `test_invariantes.py` (balayage récursif de la table de routage) + `test_securite.py` | vert |
| Aucun `localStorage` / `sessionStorage` / `document.cookie` | `invariantes-cookies.test.ts` (balayage de `app/`, `components/`, `lib/`) | vert |
| `is_staff` / `status` / `enrollment_status` refusés en entrée | `test_securite.py` + `auth-routes-degrade.test.ts` | vert |
| Pas d'énumération d'utilisateurs à l'inscription | `composants-auth.test.tsx` + tests backend `test_register.py` | vert |

---

## Réserves honnêtes

1. **`npm audit` n'a pas pu s'exécuter** : `{ error: 'Service Unavailable' }` — le registre npm
   répond en erreur derrière le proxy de cet environnement. À rejouer en CI. Ce n'est pas un test
   de l'étape, mais l'étape 0 en avait fait un contrôle de porte.
2. **Aucun test Playwright de bout en bout.** Le scénario d'intégration de `progress.md`
   (« créer un compte → se déconnecter → se reconnecter → réinitialiser → constater que les
   sessions d'un autre navigateur sont coupées ») est couvert **par unités** (services Django,
   Route Handlers, composants) mais pas en un seul parcours navigateur réel. La révocation globale
   des sessions au reset est testée côté service et côté endpoint ; ce qui n'est pas prouvé
   automatiquement, c'est le comportement combiné cookie + middleware dans un vrai navigateur.
   L'étape 2 ou 3 devra introduire Playwright.
3. **La CI n'a toujours jamais tourné** (case restée vide de l'étape 0). Toutes les commandes de
   ce rapport ont été exécutées localement ; la porte CI reste non prouvée.

---

## Verdict

**PORTE OUVERTE.**

176 tests backend et 216 tests frontend, tous verts, sur PostgreSQL réel. 100 % de couverture sur
`apps` et `config`, 100 % des lignes côté web. Le seul trou signalé au passage précédent (les
composants et pages React à 0 %) est refermé, et il a permis d'ajouter la vérification de la garde
`is_staff` de `/admin`, qui n'existait nulle part. Un seul constat de produit, MINEUR et non
bloquant : deux promesses non gérées sur coupure réseau, décrites ci-dessus avec l'emplacement
exact.

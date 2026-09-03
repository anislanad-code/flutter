# Étape 00 — Rapport de test (agent 2, `code-tester`)

**Date** : 2026-09-03
**Branche** : `etape-00-fondations`

**Environnement**
- Backend : Python 3.12.14, Django 5.1.5, DRF, PostgreSQL 16-alpine (base réelle, pas SQLite), exécuté dans `docker compose`.
- Frontend : Node v24.15.0, Next 15.1.6, React 19, Vitest 2.1.8, `@vitest/coverage-v8`.

**Commandes exécutées**
```
docker compose exec -T api pytest --cov=apps --cov=config --cov-report=term-missing
cd web && npm run test
cd web && npm run test:cov
cd web && npx tsc --noEmit
cd web && npm run lint
cd web && API_INTERNAL_URL=http://localhost:8000 npm run build
cd web && API_INTERNAL_URL=http://localhost:8000 npx next start -p 3100   # vérification runtime prod
curl -s -D - http://localhost:3100/            # inspection CSP + <script> du build de production
curl -s -D - http://localhost:3100/api/health  # BFF de bout en bout contre Django
```

---

## Tests ajoutés

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `api/tests/test_entrypoints.py` | Les points d'entrée WSGI/ASGI se chargent réellement et ne figent pas le module de settings — seul trou de couverture backend restant. | 3 |
| `web/tests/lib-api.test.ts` | `apiFetch` : chemin nominal, préfixage par l'URL interne, `cache: no-store`, surcharge des en-têtes, 204 sans corps, 400/401/403/404/500/502, corps non JSON, panne réseau, absence de configuration, expiration à 8 s via `AbortController` (horloge simulée), requête rapide non abandonnée, **non-divulgation de `api:8000` sur quatre chemins d'échec distincts**. | 20 |
| `web/tests/lib-env.test.ts` | `serverEnv` : variable présente, absente, non-URL, chaîne vide, message d'erreur qui ne contient **jamais** la valeur, cache effectif entre deux appels, échec non mis en cache, aucune clé `NEXT_PUBLIC_`. | 9 |
| `web/tests/middleware.test.ts` | CSP à nonce : en-tête posé, nonce UUID **différent sur 25 requêtes consécutives**, nonce propagé à la requête (`x-middleware-request-x-nonce` + CSP de requête, ce que Next relit pour tamponner ses scripts), `'strict-dynamic'` présent, **`'unsafe-inline'` absent de `script-src` y compris en dev**, `default-src`/`frame-ancestors`/`object-src`/`base-uri`/`form-action`/`frame-src`/`upgrade-insecure-requests`, aucune frame tierce ni joker, CSP fournie par le client non recopiée, politique identique quel que soit le chemin, assouplissements `unsafe-eval`/`ws:` limités au dev, matcher qui exclut les statiques. | 19 |
| `web/tests/marketing-page.test.ts` | Page de référence rendue en HTML statique (`renderToStaticMarkup`) : structure `main`/`h1` unique, les 6 jetons du §6 et leurs hexadécimaux, les 9 niveaux typographiques, les 4 états du parcours, un seul `<pre>` et il contient du Dart (mono réservée au vrai code), `aria-labelledby` tous résolus, décorations en `aria-hidden`, **aucune trace de `:8000` ni de `localhost`**, liens internes uniquement, aucun `<script>` injecté, `robots: noindex`. | 12 |
| `web/tests/layout.test.ts` | `RootLayout` : `lang="fr"`, les trois variables de police du §6, enfants rendus dans `<body>`, aucun script ni URL tierce dans le squelette, métadonnées de marque sans formation codée en dur. | 5 |

Existant conservé sans modification : `web/tests/health-route.test.ts` (4 cas) et les 39 tests backend de `dcf7d3c`.

**Infrastructure de test modifiée** (`web/vitest.config.ts`, jamais du code de production) :
- `esbuild: { jsx: "automatic" }` — `tsconfig.json` laisse `jsx: "preserve"` (c'est le compilateur de Next qui transforme) ; sans cela, tout rendu de composant échoue sur `ReferenceError: React is not defined`.
- `middleware.ts` ajouté à l'`include` de la couverture : il n'était mesuré par rien.

---

## Résultats

### Backend
```
tests/test_health.py ...........                                         [ 26%]
tests/test_security_baseline.py .                                        [ 28%]
tests/test_urls.py ...                                                   [ 35%]
tests/test_entrypoints.py ...                                            [ 42%]
tests/test_security_baseline.py ........                                 [ 61%]
tests/test_settings_config.py ..............                             [ 95%]
tests/test_urls.py ..                                                    [100%]

---------- coverage: platform linux, python 3.12.14-final-0 ----------
config/asgi.py                       4      0   100%
config/health.py                    19      0   100%
config/settings/base.py             40      0   100%
config/settings/dev.py               6      0   100%
config/settings/prod.py             13      0   100%
config/urls.py                       6      0   100%
config/wsgi.py                       4      0   100%
--------------------------------------------------------------
TOTAL                              124      0   100%

============================== 42 passed in 0.89s ==============================
```

### Frontend
```
 ✓ tests/layout.test.ts (5 tests)
 ✓ tests/marketing-page.test.ts (12 tests)
 ✓ tests/middleware.test.ts (19 tests)
 ✓ tests/health-route.test.ts (4 tests)
 ✓ tests/lib-env.test.ts (9 tests)
 ✓ tests/lib-api.test.ts (20 tests)

 Test Files  6 passed (6)
      Tests  69 passed (69)
```
`tsc --noEmit` : sans erreur. `next lint` : `✔ No ESLint warnings or errors`. `next build` : compilé.

---

## Couverture

| Zone | Stmts | Branch | Lignes non couvertes |
|---|---|---|---|
| `api/` (`apps` + `config`) | **100 %** | — | aucune |
| `web/middleware.ts` | 100 % | 100 % | aucune |
| `web/app/layout.tsx` | 100 % | 100 % | aucune |
| `web/app/(marketing)/page.tsx` | 100 % | 100 % | aucune |
| `web/app/api/health/route.ts` | 100 % | 100 % | aucune |
| `web/lib/env.ts` | 100 % | 100 % | aucune |
| `web/lib/api.ts` | 100 % | 88,9 % | branche résiduelle ligne 40 : le cas « `init.headers` fourni **et** écrasant `Content-Type` » n'est pas distingué du cas « en-têtes ajoutés ». Sans effet observable. |
| **Total web** | **100 %** | **96,8 %** | — |

Cible de 80 % largement dépassée des deux côtés.

---

## Régressions détectées

Aucune. Les 39 tests backend antérieurs et les 4 tests `health-route` passent à l'identique.

---

## Tests rouges

Aucun test rouge. **La porte est néanmoins fermée** pour le défaut d'intégration ci-dessous, qu'aucun test unitaire ne peut voir parce qu'il ne se manifeste qu'entre le build de production et le middleware.

### BLOQUANT-1 — La CSP à nonce tue tout le JavaScript en production

`middleware.ts` émet `script-src 'self' 'nonce-…' 'strict-dynamic'`. Avec `'strict-dynamic'`, la source `'self'` est **ignorée par le navigateur** : seuls les scripts portant le nonce s'exécutent. Or `next build` prérend `/` en statique :

```
Route (app)                              Size     First Load JS
┌ ○ /                                    139 B           105 kB     ← ○ = Static
```

Le HTML statique est généré au build, avant toute requête : il ne peut pas porter le nonce de la requête. Vérification sur le serveur de production réel (`next start`) :

```
$ curl -s -D - http://localhost:3100/ -o /tmp/p2.html
content-security-policy: default-src 'self'; script-src 'self' 'nonce-67d063d3-…' 'strict-dynamic'; …

$ grep -o '<script[^>]*>' /tmp/p2.html | head -5
<script src="/_next/static/chunks/4bd1b696-20882bf820444624.js" async="">
<script src="/_next/static/chunks/517-fe882a976a10ccc2.js" async="">
<script src="/_next/static/chunks/main-app-a78c472177cf86a2.js" async="">
<script src="/_next/static/chunks/polyfills-42372ed130431b0a.js" noModule="">
<script src="/_next/static/chunks/webpack-b0109d503bf2baf5.js" async="">

$ grep -o 'nonce="[^"]*"' /tmp/p2.html | sort -u
(aucune sortie)
```

**Aucun** script de la page prérendue ne porte de nonce, alors que l'en-tête en exige un. Tous seront bloqués : pas d'hydratation, pas de navigation client, pas de RSC.

Pourquoi ça n'a pas été vu : le conteneur `web` tourne en `next dev`, où le rendu est dynamique. La même requête sur le port 3000 (dev) montre bien tous les `<script … nonce="5faea19b-…">`. **La validation « la page marche » de l'étape 0 a été faite en développement uniquement ; elle ne prouve rien sur la production.**

Conséquence pour la suite : à l'étape 1, les formulaires d'inscription et de connexion sont des composants clients. Sans hydratation, ils ne fonctionnent pas du tout. Le défaut doit être corrigé maintenant, pas après.

Piste de correction (hors de mon périmètre — je ne touche pas au code de production) : forcer le rendu dynamique des routes couvertes par le middleware (`export const dynamic = "force-dynamic"`, ou lecture de `headers()` dans le layout), ou ne servir la CSP à nonce que sur les réponses réellement rendues à la requête et une CSP hachée/`'self'` sans `'strict-dynamic'` sur les routes prérendues. Le contournement interdit, et je le nomme pour qu'il ne soit pas tenté : ajouter `'unsafe-inline'`.

---

## Constatations mineures (non bloquantes, documentées par un test)

- **MINEUR-1 — `/api/health` annonce `status: "ok"` base éteinte.** Déjà couvert par `test_health_annonce_ok_meme_quand_la_base_est_tombee`. Le code HTTP (503) est correct et c'est lui que lit le BFF, mais le corps ment. Cosmétique tant que personne ne lit le champ.
- **MINEUR-2 — `serverEnv` n'impose pas le schéma de l'URL.** `z.url()` accepte `ftp://api:8000`. Sans conséquence aujourd'hui (la valeur vient du compose), mais le schéma devrait être borné à `http`/`https` avant la mise en production. Couvert par un test qui documente le comportement constaté.
- **MINEUR-3 — `apiFetch` rejette au lieu de renvoyer `ok: false` si `API_INTERNAL_URL` manque**, parce que `serverEnv()` est appelé hors du `try`. C'est défendable (une erreur de déploiement doit se voir) et le message ne divulgue aucune valeur ; le test le fige explicitement pour qu'un changement de comportement soit conscient.
- **MINEUR-4 — aucun test de bout en bout.** L'étape 0 n'introduit aucun parcours utilisateur, donc pas de Playwright ici. Il en faudra un dès l'étape 1.

## Invariantes du §4 rejouées

| Invariante | État |
|---|---|
| `Choice.is_correct` jamais sérialisé | Sans objet (aucun modèle) — à rejouer à l'étape 2. |
| Aucune URL de fichier vidéo dans une réponse | Vérifié : aucune réponse d'API ne contient d'URL externe. |
| Compte `PENDING` limité au chapitre `is_free` | Sans objet — à rejouer à l'étape 2. |
| Cookies d'auth `httpOnly`/`Secure`/`SameSite=Strict` | Sans objet (aucune auth) ; vérifié que `/api/health` **ne pose aucun cookie**. |
| Aucune route ne définit le mot de passe d'un tiers | Vérifié : la table de routage n'expose que `/api/health` et l'admin Django. |
| L'URL interne de Django ne fuit jamais vers le client | Vérifié : 6 tests dédiés côté `lib/api.ts`, plus `grep -c 8000` = 0 sur le HTML de production et sur celui de dev. |

---

## Verdict

**PORTE FERMÉE.**

111 tests, 111 verts, 0 rouge, couverture 100 % backend et 100 % des instructions côté web (96,8 % des branches) — la couverture demandée est atteinte et largement dépassée. Mais **BLOQUANT-1** est une régression fonctionnelle silencieuse qui ne se déclenche qu'en production : la CSP à nonce, ajoutée en fin d'étape 0 pour réparer la CSP statique, bloque l'intégralité du JavaScript de la page prérendue. L'étape ne peut pas être cochée tant que le rendu de production n'a pas été vérifié avec les scripts qui s'exécutent, en plus des deux points déjà ouverts dans `progress.md` (rapports `code-reviewer` et `security-tester`, CI jamais exécutée).

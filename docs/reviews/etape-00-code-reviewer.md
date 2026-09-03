# Étape 00 — Revue de code

**Date** · 2026-09-03
**Branche** · `etape-00-fondations` — commits `11bed77`, `dcf7d3c`, `62b96cc`
**Périmètre** · l'intégralité du dépôt (l'étape 0 crée tout) : `.gitignore`, `.env.example`,
`docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`, `api/**`, `web/**`.
Exclus : `node_modules/`, `.claude/skills/`, caches.

**Je ne corrige rien.** Ce document constate.

---

## Commandes exécutées et résultat brut

Backend, dans le conteneur (`docker compose exec -T api …`) :

| Commande | Résultat |
|---|---|
| `ruff check .` | `All checks passed!` |
| `ruff format --check .` | `41 files already formatted` |
| `mypy apps config` | `Success: no issues found in 34 source files` |
| `python manage.py makemigrations --check --dry-run` | `No changes detected` |
| `pytest --cov=apps --cov=config --cov-report=term-missing` | `39 passed in 0.87s` — TOTAL **94 %** (124 instructions) |

Web, depuis `web/` :

| Commande | Résultat |
|---|---|
| `npm run lint` | `✔ No ESLint warnings or errors` |
| `npm run typecheck` | aucune sortie (vert) |
| `npm run test` | **ROUGE** — `Tests 1 failed | 48 passed (49)`, reproductible 3 fois de suite |
| `API_INTERNAL_URL=http://localhost:8000 npm run build` | `✓ Compiled successfully` — `/` en `○ (Static)`, `/api/health` en `ƒ (Dynamic)` |

Vérifications manuelles complémentaires :

- `git clone` du dépôt dans un répertoire vierge → `api/apps/` ne contient **que 7 applications sur 8**.
- `npx next start` sur le build de production + `curl -D-` sur `/` → en-tête CSP à nonce présent,
  **aucun** `nonce=` dans le HTML servi.
- Aucun secret réel dans les fichiers suivis (`git grep` sur `secret|password|api_key`) ;
  les clés de `.env.example` et de `.env` coïncident exactement.

Remarque sur le 94 % de couverture backend : sur 124 instructions mesurées, ~100 sont des
`__init__.py` vides, des `models.py` vides et huit `apps.py` de quatre lignes. Le code réel de
l'étape se réduit à `config/health.py`, `config/urls.py` et les trois modules de réglages. Le
chiffre est exact mais il ne dit pas grand-chose de la qualité de la couverture.

---

## BLOQUANT

### 1. L'application `apps.media` n'est pas dans le dépôt — `.gitignore` l'avale

- **Emplacement** : `.gitignore:27` (`media/`), en conflit avec `api/apps/media/` et
  `api/config/settings/base.py:45` (`"apps.media"` dans `LOCAL_APPS`).
- **Constat** : la règle `media/` du `.gitignore` est écrite pour le répertoire d'uploads Django,
  mais elle est sans ancrage : elle correspond à **n'importe quel** répertoire nommé `media`, donc
  aussi à `api/apps/media/`. Preuve :

  ```
  $ git check-ignore -v api/apps/media/apps.py
  .gitignore:27:media/	api/apps/media/apps.py

  $ git clone <dépôt> clonetest && ls clonetest/api/apps/
  __init__.py accounts assessment audit catalog certification enrollment learning
  # media : absent
  ```

  Le répertoire existe sur la machine de développement, donc tout est vert localement. Il n'existe
  dans aucun clone.
- **Règle enfreinte** : CLAUDE.md §3 (les huit applications de l'arborescence), et le critère de
  sortie de `progress.md` « `docker compose up` fonctionne depuis un clone vierge en suivant le
  README », coché `[x]` le 2026-09-03.
- **Conséquence** : depuis un clone vierge, `django.setup()` échoue sur
  `ModuleNotFoundError: No module named 'apps.media'`. L'API ne démarre pas, `docker compose up` ne
  monte pas, la CI (quand elle tournera) sera rouge dès l'installation. Le critère coché est faux.
  Le test `api/tests/test_settings_config.py:54` qui vérifie les huit applications passe localement
  et passerait rouge en CI — il ne protège de rien tant que le fichier n'est pas suivi.
- **Piste** : la règle d'ignorance des uploads doit désigner un chemin, pas un nom.

### 2. La CSP à nonce rend la page `/` inutilisable en production

- **Emplacement** : `web/middleware.ts:15` (`script-src 'self' 'nonce-…' 'strict-dynamic'`),
  `web/app/(marketing)/page.tsx` (page sans rendu dynamique).
- **Constat** : `next build` prérend `/` en statique (`○ (Static)` dans la sortie du build). Le HTML
  est donc figé au moment du build, tandis que le middleware émet un nonce **neuf à chaque
  requête**. Résultat mesuré sur le build de production servi par `next start` :

  ```
  $ curl -s -D- http://localhost:3111/ | grep -i content-security-policy
  content-security-policy: default-src 'self'; script-src 'self'
    'nonce-1d1cf697-43dd-4b21-9336-dc557d6fe80e' 'strict-dynamic'; …

  $ grep -o '<script[^>]*>' prod.html
  <script src="/_next/static/chunks/4bd1b696-….js" async="">
  <script src="/_next/static/chunks/517-….js" async="">
  <script src="/_next/static/chunks/main-app-….js" async="">
  <script src="/_next/static/chunks/polyfills-….js" noModule="">
  <script src="/_next/static/chunks/webpack-….js" async="">
  <script>  <script>  <script>       ← charge utile RSC en ligne
  ```

  Aucun `nonce=` nulle part. Et `'strict-dynamic'` **annule** `'self'` et toute source d'hôte dans
  les navigateurs qui gèrent CSP niveau 3 : les cinq chunks externes sont bloqués au même titre que
  les scripts en ligne. En développement la même page est rendue dynamiquement et Next injecte
  correctement le nonce (vérifié sur `http://localhost:3000/`, `nonce="25381c04-…"` sur chaque
  balise) — d'où l'illusion que le problème est réglé.
- **Règle enfreinte** : CLAUDE.md §4.6 (CSP stricte) contre §6 (« plancher de qualité, non
  négociable »). Une CSP qui casse la page n'est pas une CSP stricte, c'est une panne.
- **Conséquence** : la landing — c'est-à-dire l'entonnoir de vente entier — est morte en production :
  zéro JavaScript, aucune hydratation, aucune navigation client. Le défaut est structurel, pas
  propre à cette page provisoire : toute page statique future subira le même sort, y compris la vraie
  landing de l'étape 2.
- **Piste** : le nonce et le prérendu statique sont incompatibles par construction ; il faut choisir
  entre rendre dynamiques les routes concernées et poser une CSP qui n'a pas besoin de nonce (hachage
  ou politique différenciée par route).

---

## MAJEUR

### 1. `apiFetch` perd silencieusement les en-têtes qu'on lui passe

- **Emplacement** : `web/lib/api.ts:26`
  ```ts
  headers: { "Content-Type": "application/json", ...init.headers },
  ```
- **Constat** : `init.headers` est de type `HeadersInit`, c'est-à-dire `Headers |
  string[][] | Record<string, string>`. Le spread d'objet ne fonctionne que sur la troisième forme :
  passer un `Headers` (le cas normal quand on relaie les en-têtes d'une requête entrante) produit un
  objet vide, et passer un tableau de paires produit des clés `0`, `1`, `2`. Aucune erreur, aucun
  avertissement de TypeScript.
- **Règle enfreinte** : CLAUDE.md §7 — gestion des cas limites ; §3 — le Route Handler est le seul
  endroit où le cookie httpOnly est rattaché à l'appel Django.
- **Conséquence** : à l'étape 1, un Route Handler qui relaiera `Cookie` ou `Authorization` via un
  objet `Headers` verra son en-tête disparaître. Le symptôme sera un 401 inexplicable, très loin de
  sa cause.
- **Piste** : normaliser l'entrée avec le constructeur `Headers` avant de fusionner.

### 2. `API_INTERNAL_URL` accepte n'importe quel schéma d'URL

- **Emplacement** : `web/lib/env.ts:6` — `API_INTERNAL_URL: z.url()`.
- **Constat** : `z.url()` valide la syntaxe, pas le protocole. `ftp://secret-interne:8000/x` passe,
  `file://…` aussi. C'est ce que met en évidence le test rouge de l'arbre de travail
  (`web/tests/lib-env.test.ts:54`) : il attend un message d'erreur, `serverEnv()` n'en lève aucun
  parce que la valeur est jugée valide.
- **Règle enfreinte** : CLAUDE.md §7 — « le front ne fait jamais confiance à la forme des données ».
  La contrainte réelle sur cette variable est « http ou https », pas « URL ».
- **Conséquence** : une faute de frappe dans le `.env` de production ne se voit pas au démarrage,
  elle se voit à la première requête, sous la forme d'un `fetch` qui échoue et d'un 503 générique.
- **Piste** : la contrainte de schéma doit figurer dans le schéma Zod.

### 3. La page de référence de design duplique les jetons — et annonce des valeurs fausses

- **Emplacement** : `web/app/(marketing)/page.tsx:11-66`.
- **Constat** : deux problèmes dans le même tableau de données.
  1. Les six couleurs de la palette sont réécrites en hexadécimal dans le composant
     (`valeur: "#FAFAF7"`, `"#14201E"`, `"#0E6E63"`, `"#E0A22B"`, `"#6E7B78"`, `"#B4342A"`),
     alors qu'elles sont déjà définies dans `web/styles/tokens.css:6-11`.
  2. Le tableau `echelle` (lignes 57-59) annonce `--texte-5xl → 4rem`, `--texte-4xl → 3rem`,
     `--texte-3xl → 2.25rem`. Or ces trois jetons sont passés en `clamp()` (`tokens.css:26-28`) :
     `--texte-5xl` vaut `clamp(2.5rem, 9vw, 4rem)`. À 360 px — la largeur cible du §6 — la page
     affiche « 4rem » à côté d'un texte rendu à 2,5rem.
- **Règle enfreinte** : CLAUDE.md §7 (« Pas de valeurs hexadécimales en dur dans les composants ») et
  §6 (cette page *est* la référence de design ; une référence qui ment n'en est pas une). Duplication
  de source de vérité.
- **Conséquence** : le jour où un jeton bouge, la page de référence continue d'afficher l'ancienne
  valeur — ce qui est déjà arrivé, en une seule journée, sur trois lignes sur neuf.
- **Piste** : une valeur affichée doit être lue au jeton, pas recopiée à côté.

### 4. Le BFF confond « API injoignable » et « base de données tombée »

- **Emplacement** : `web/app/api/health/route.ts:19-21`, en regard de `api/config/health.py:27`.
- **Constat** : quand la base est tombée, Django répond **503** avec un corps parfaitement valide
  (`{"status":"ok","db":"down"}`). `apiFetch` traite tout code non-2xx comme un échec
  (`lib/api.ts:32`) et renvoie `ok: false`. Le Route Handler conclut alors
  `{"status":"down","api":"unreachable"}` : il déclare l'API injoignable alors qu'elle vient de
  répondre, et il perd l'information utile (c'est la base, pas l'API).
  Corollaire : la branche `"down"` de `healthSchema` (`route.ts:13`) est **inatteignable**, puisque
  le seul cas qui la produirait est intercepté avant. C'est du code mort déguisé en validation.
- **Règle enfreinte** : CLAUDE.md §7 — gestion d'erreurs et cas limites ; §3 — le BFF relaie, il
  n'invente pas de diagnostic.
- **Conséquence** : la première sonde du projet donne une réponse fausse dans le seul cas de panne
  qu'elle est censée détecter. En exploitation, on ira chercher un problème réseau au lieu de la base.
- **Piste** : `apiFetch` doit distinguer « pas de réponse HTTP » d'« une réponse HTTP d'erreur avec
  un corps exploitable ».

### 5. La CI est aveugle exactement là où le BLOQUANT 1 s'est glissé

- **Emplacement** : `.github/workflows/ci.yml` (jobs `api`, `web`, `secrets`).
- **Constat** : le workflow rejoue les commandes locales, ce qui est bien, mais :
  - il ne construit ni ne démarre **aucune** image Docker, alors que le critère de sortie de l'étape
    est « `docker compose up` fonctionne depuis un clone vierge » ;
  - il n'exerce jamais `config.settings.prod` (`DJANGO_SETTINGS_MODULE: config.settings.dev`,
    ligne 32) — or c'est prod qui porte HSTS, `SECURE_SSL_REDIRECT` et l'exigence de
    `DJANGO_ADMIN_PATH` ;
  - `pytest` tourne sans `--cov-fail-under` (ligne 71) et `vitest` sans seuil : la cible « ≥ 80 % sur
    le code de l'étape » de CLAUDE.md §8 n'est mesurée nulle part par la machine.
- **Règle enfreinte** : `progress.md` étape 0 (« une CI qui casse quand le code est mauvais »),
  CLAUDE.md §8.
- **Conséquence** : la CI aurait laissé passer le BLOQUANT 1. Une CI qui ne casse pas sur le seul
  défaut bloquant de l'étape ne remplit pas son contrat. Le fait qu'elle n'ait jamais été exécutée
  (case `[~]` de `progress.md`) aggrave le point : ces jobs sont, à ce jour, une hypothèse.
- **Piste** : ce qui est promis dans le critère de sortie doit être ce que la CI exécute.

### 6. Un test entérine un défaut connu et renvoie vers un rapport qui n'existe pas

- **Emplacement** : `api/tests/test_health.py:79-88`.
- **Constat** : le test s'appelle `test_health_annonce_ok_meme_quand_la_base_est_tombee`, sa
  docstring dit « Comportement constaté, pas souhaité : voir le rapport de l'étape 0 (MINEUR-1) », et
  il assère `corps == {"status": "ok", "db": "down"}`. Il verrouille donc en vert un comportement que
  son auteur qualifie lui-même d'incorrect, et il référence un rapport qui n'était pas écrit au
  moment du commit `dcf7d3c` (`docs/reviews/` était vide).
- **Règle enfreinte** : CLAUDE.md §7 — pas de code mort ni de dette non signalée ; le rôle d'un test
  est de défendre une invariante, pas d'archiver un bug.
- **Conséquence** : le jour où quelqu'un corrige le champ `status`, ce test devient rouge et fera
  croire à une régression. La dette est invisible depuis la suite (39 verts) et lisible seulement
  dans une docstring.
- **Piste** : soit l'invariante est ce qu'on veut et le test la nomme comme telle, soit c'est un
  défaut et il appartient à un rapport, pas à une assertion verte.

### 7. La suite de tests web est rouge et non commitée

- **Emplacement** : `web/tests/lib-env.test.ts`, `web/tests/lib-api.test.ts`,
  `web/tests/middleware.test.ts` — les trois **non suivis par git** au moment de la revue.
- **Constat** : `npm run test` sur l'arbre de travail donne `1 failed | 48 passed (49)`, reproductible
  trois fois. Le seul fichier de test web commité est `tests/health-route.test.ts` (4 tests, verts).
  Deux observations distinctes :
  - l'échec est réel et pointe le MAJEUR 2 ci-dessus (`z.url()` trop permissif) ;
  - une première exécution a produit **deux** échecs au lieu d'un, le second dans
    `lib-api.test.ts:148` (« échoue bruyamment si la configuration serveur manque »). Ce test dépend
    de l'état de `process.env`, que `lib-env.test.ts` manipule globalement
    (`afterEach` ligne 20 : `process.env = { ...environnementInitial }`). Il y a un couplage entre
    fichiers de test, donc un risque d'intermittence en CI.
- **Règle enfreinte** : CLAUDE.md §8 — « une étape avec un test rouge est BLOQUÉE » ; §7 — l'arbre
  poussé doit être celui qu'on a vérifié.
- **Conséquence** : l'état de l'étape n'est pas reproductible. Ce que la CI exécutera (4 tests) n'est
  pas ce qui tourne sur la machine (49). Deux des trois manques listés par `progress.md`
  (« compléter les tests web ») sont sur le disque mais hors du dépôt.
- **Piste** : ces fichiers relèvent du rapport `code-tester` ; ils doivent être commités et verts, et
  l'isolation de `process.env` entre fichiers doit être garantie.

---

## MINEUR

1. **La sonde se déclare « ok » en répondant 503.** `api/config/health.py:27-28` : quand la base est
   tombée, le corps reste `{"status": "ok", "db": "down"}`. Le code HTTP est juste, le champ ment.
   C'est la cause racine du MAJEUR 4.
2. **La sonde est publique, non limitée, et ouvre une requête SQL à chaque appel.**
   `api/config/health.py:15-25` : `AllowAny` sans throttle. Une boucle `curl` transforme la sonde en
   générateur de charge sur PostgreSQL. À revoir avec le rate limiting de l'étape 1.
3. **`DJANGO_ADMIN_PATH` vaut `admin` par défaut.** `api/config/settings/base.py:22` : seul `prod.py`
   exige une valeur explicite. Tout environnement qui n'est ni dev ni prod — un futur `staging` —
   servira l'admin Django sur `/admin/`, ce que §4.6 proscrit.
4. **Reliquats du gabarit `create-next-app`.** `web/app/favicon.ico` (25,9 ko) est l'icône Next.js
   par défaut, et `web/.gitignore` est le fichier généré (`.pnp.*`, `.yarn/*`, `/build`, `.vercel`),
   qui recouvre partiellement le `.gitignore` racine. Deux fichiers d'ignorance pour un même dépôt,
   c'est une occasion de plus de rater une règle — voir BLOQUANT 1.
5. **`next lint` est déprécié.** `web/package.json:8` : Next 15 avertit, Next 16 supprime la commande.
   La CI (`ci.yml:96`) en dépend.
6. **Jeton mort.** `web/styles/tokens.css:47` définit `--bordure`, utilisé nulle part.
7. **Mono sur des métadonnées, et styles en ligne évitables.**
   `web/app/(marketing)/page.tsx:97, 119` utilise `<code>` (donc JetBrains Mono) pour des noms de
   jetons et des étiquettes, ce que §6 interdit explicitement (« jamais pour des étiquettes, des
   badges ou des métadonnées »). Et lignes 71, 85, 144, 193 posent des couleurs en `style={{…}}`
   alors que `tailwind.config.ts:13-20` expose déjà `border-muted`, `bg-ink`, `text-zellige`. Deux
   manières de faire la même chose dans un fichier de 200 lignes.
8. **Les requêtes de préchargement n'ont aucune CSP.** `web/middleware.ts:48-51` : la clause
   `missing` exclut du middleware toute requête portant `next-router-prefetch` ou `purpose:
   prefetch`. Ces réponses partent donc sans en-tête `Content-Security-Policy`.
9. **`docker-compose.yml` : redondance et dépendance molle.** `API_INTERNAL_URL` est défini deux fois
   pour `web` (via `env_file: .env` puis `environment:` ligne 40) ; et `web.depends_on` (ligne 45-46)
   n'a pas de `condition: service_healthy`, ni `api` de `healthcheck`, alors que `db` en a un. Au
   premier démarrage, `web` répond avant que l'API ne soit prête.
10. **Test tautologique.** `web/tests/health-route.test.ts:43-49` : le mock renvoie `ok: false`, cas
    dans lequel le Route Handler retourne un littéral figé sans jamais lire le champ `error`.
    L'assertion « ne divulgue pas l'URL interne » ne peut pas échouer, quelle que soit
    l'implémentation. Elle rassure sans rien vérifier.
11. **En-têtes de production posés en développement.** `web/next.config.ts:11-14` envoie HSTS
    (1 an, `preload`) sur `http://localhost`, et `web/middleware.ts:26` ajoute
    `upgrade-insecure-requests` en dev. Sans effet aujourd'hui, mais c'est le genre de réglage qui
    surprend le jour où un poste sert le site sur un autre hôte que `localhost`.
12. **Artefacts d'outillage dans le `.gitignore` du projet.** `.gitignore:30-32` (`.playwright-mcp/`,
    `/*.png`) : de la configuration d'outil personnel dans un fichier partagé. `/*.png` en particulier
    ignorera aussi les images légitimes déposées à la racine.

---

## Ce qui est bien fait — et qu'il faut garder

Ce n'est pas une politesse : ces points sont des invariantes qu'il ne faudra pas perdre aux étapes
suivantes.

- La découpe `base / dev / prod` respecte la doctrine annoncée en tête de `base.py` : le socle est
  strict, `dev.py` ne relâche que `SESSION_COOKIE_SECURE` et `CSRF_COOKIE_SECURE`, `prod.py` ne fait
  que durcir. Aucune valeur par défaut n'adoucit un choix de sécurité, et l'absence de
  `DJANGO_SECRET_KEY` tue le processus (`base.py:17`, prouvé par un test en sous-processus).
- Le deny-by-default de DRF est complet, pas seulement `DEFAULT_PERMISSION_CLASSES` : renderer JSON
  seul (pas d'API navigable), `DEFAULT_AUTHENTICATION_CLASSES` vide, `UNAUTHENTICATED_USER: None`.
  L'unique exception publique est déclarée sur la vue elle-même (`health.py:15-16`).
- La frontière navigateur → Route Handler → Django tient : aucun `NEXT_PUBLIC_` ne porte l'URL de
  l'API, `lib/api.ts` importe `server-only`, la page rendue par le conteneur ne contient aucune
  occurrence du port 8000, et le Route Handler valide la réponse par Zod avant de la relayer.
- Le fichier `tokens.css` est bien la source unique de la palette côté CSS, et `tailwind.config.ts`
  ne fait que pointer dessus — aucune couleur en dur dans une classe utilitaire.
- `test_security_baseline.py` pose un harnais de contrôles qui se remplira tout seul quand les
  serializers et les routes apparaîtront (recherche de `is_correct`, de `fields = "__all__"`, d'URL
  Bunny, de route de changement de mot de passe par un tiers). C'est la bonne idée de l'étape.

---

## Verdict

**PORTE FERMÉE.**

Deux constatations bloquantes, indépendantes l'une de l'autre, et qui ont en commun de n'être
visibles ni localement ni en CI :

1. Le dépôt ne contient pas l'application `apps.media` : aucun clone ne démarre. Le critère
   « `docker compose up` depuis un clone vierge » est coché dans `progress.md` alors qu'il est faux.
2. La page `/` est privée de tout JavaScript en production, la CSP à nonce et le prérendu statique
   étant incompatibles. Le correctif noté comme appliqué dans `progress.md` ne vaut qu'en
   développement.

S'y ajoutent une suite web rouge et non commitée (MAJEUR 7) et une CI qui, telle qu'elle est écrite,
n'aurait détecté ni l'une ni l'autre des deux constatations bloquantes (MAJEUR 5).

**Décompte : 2 BLOQUANT · 7 MAJEUR · 12 MINEUR.**

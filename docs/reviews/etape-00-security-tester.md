# Étape 0 — Rapport de sécurité (security-tester)

- **Date** : 2026-09-03
- **Branche** : `etape-00-fondations` (3 commits : `11bed77`, `dcf7d3c`, `62b96cc`)
- **Cibles** : `http://localhost:3000` (Next 15.1.6), `http://127.0.0.1:8000` (Django 5.1.5, publié
  sur la boucle locale uniquement), `postgres:16-alpine` (non publié), le dépôt git et sa CI.
- **Comptes utilisés** : aucun. Il n'existe ni modèle `User`, ni authentification, ni contenu,
  ni téléversement à l'étape 0. Le modèle de menace habituel (étudiant payant qui exfiltre les
  vidéos, visiteur `PENDING` qui veut le contenu) n'a aucune surface à attaquer aujourd'hui.
- **Ce qui a pu être testé** : configuration, exposition réseau, en-têtes, CSP, CORS,
  secrets dans l'historique git, fuite d'information (sonde, 404, panne de base), journalisation,
  chaîne d'approvisionnement (dépendances), intégrité du dépôt.
- **Ce qui n'a pas pu l'être** : points 1 à 5 et 7 de la checklist §8 — voir « Non testé ».

---

## Synthèse

| # | Point de la checklist §8 | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | IDOR | **NON** | Aucune ressource, aucun id, aucun compte | — |
| 2 | Fuite de contenu | Partiel | Aucune fuite dans le HTML/RSC : `8000`, `api:8000`, `API_INTERNAL_URL` absents. Le 404 de Django en `DEBUG` divulgue l'URLconf complet, chemin d'admin compris | MOYEN |
| 3 | Escalade de privilèges | **NON** | Aucun serializer, aucun POST/PATCH | — |
| 4 | Contournement de paywall | **NON** | Aucun contenu, aucun `Enrollment` | — |
| 5 | Vidéo | **NON** | Ni Bunny, ni `PlaybackToken`, ni lecteur | — |
| 6 | Auth | **NON** | Aucun endpoint d'authentification | — |
| 7 | Uploads | **NON** | Aucun endpoint de téléversement | — |
| 8 | Injection | Partiel | Aucun champ texte libre, aucune requête SQL paramétrée par le client, aucun `dangerouslySetInnerHTML` | FAIBLE |
| 9 | En-têtes et config | **OUI** | **Le middleware Next — donc la CSP — se contourne avec un seul en-tête HTTP**, par deux chemins distincts. `DJANGO_ADMIN_PATH` vide monte l'admin Django en production | **CRITIQUE** |
| 10 | Journalisation | **OUI** | 729 lignes de `docker compose logs` : aucun secret, aucune clé, aucune URL interne | RAS |

**Décompte : 1 CRITIQUE · 2 ÉLEVÉ · 5 MOYEN · 3 FAIBLE.**

---

## CRITIQUE

### C1. Le middleware Next se désactive avec un en-tête de requête (CVE-2025-29927) — toute la CSP tombe

- **Emplacement** : `web/package.json:15` — `"next": "15.1.6"`. Correctif amont : 15.2.3.
  Avis : `GHSA-f82v-jwr5-mffw` (« Authorization Bypass in Next.js Middleware », sévérité critique).
- **Preuve** :

```
$ curl -sS -D- -o /dev/null http://localhost:3000/
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'nonce-0413da85-...' 'strict-dynamic' ...

$ curl -sS -D- -o /dev/null \
    -H "x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware" \
    http://localhost:3000/
HTTP/1.1 200 OK
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Vary: RSC, Next-Router-State-Tree, ...
Content-Type: text/html; charset=utf-8
        ← aucun en-tête content-security-policy

$ curl -sS -H "x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware" \
    http://localhost:3000/ | grep -c "nonce="
0
```

  La page complète (58 561 octets) est servie en 200, sans CSP et sans un seul `nonce=` dans le
  HTML. `web/middleware.ts` n'a pas été exécuté du tout.

- **Impact** : aujourd'hui, un attaquant supprime à volonté la seule défense applicative que
  l'étape 0 a livrée. **Demain, c'est bien pire** : `progress.md` étape 1 prévoit
  « Middleware Next qui protège `/app` et `/admin` ». Le même en-tête désactivera ce contrôle
  d'accès. C'est exactement ce que la CVE décrit, et le projet a choisi de mettre son
  autorisation front dans le composant vulnérable.
- **Aggravant** : la même version 15.1.6 traîne `GHSA-ffhc-5mcf-pf4q`
  (« Next.js vulnerable to cross-site scripting in App Router applications using CSP nonces »),
  qui vise précisément le mécanisme de nonce mis en place ici, et
  `GHSA-4342-x723-ch2f` (SSRF via la gestion des redirections de middleware).
  `npm audit --omit=dev` sur `web/` : **3 vulnérabilités, dont 1 critique et 2 hautes**
  (`next`, `postcss`, `sharp`).
- **Règle enfreinte** : CLAUDE.md §4.6 (« CSP stricte »), et par anticipation §4.3
  (« Deny by default », le cloisonnement doit tenir).
- **Remédiation** : monter Next à une version corrigée de la branche 15 et ne jamais
  laisser l'autorisation reposer uniquement sur le middleware — le contrôle d'accès reste
  côté Django, le middleware n'est qu'un raccourci d'expérience utilisateur. Ajouter un
  contrôle de dépendances (`npm audit --audit-level=high`, `pip-audit`) au workflow CI :
  le job `secrets` existe, le job « dépendances vulnérables » manque.

---

## ÉLEVÉ

### E1. Le `matcher` du middleware exclut des requêtes sur la foi d'en-têtes contrôlés par le client

- **Emplacement** : `web/middleware.ts:43-54`

```ts
export const config = {
  matcher: [
    { source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ] },
  ],
};
```

  `next-router-prefetch` et `purpose` sont des en-têtes de requête ordinaires : n'importe qui
  les pose. Ce n'est pas un canal de confiance.

- **Preuve** :

```
$ curl -sS -D- -o /dev/null -H "purpose: prefetch" http://localhost:3000/
HTTP/1.1 200 OK
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
...
Content-Type: text/html; charset=utf-8
        ← aucun en-tête content-security-policy, et le document HTML complet est servi

$ curl -sS -D- -o /dev/null -H "next-router-prefetch: 1" http://localhost:3000/
HTTP/1.1 500 Internal Server Error
        ← également sans CSP
```

- **Impact** : deuxième chemin, indépendant de C1, pour obtenir un document sans CSP. Un
  navigateur qui préfetche (`<link rel="prefetch">`, règles de spéculation, préfetch du routeur
  Next) envoie ces en-têtes et **rend ensuite le document depuis ce cache** : la navigation
  réelle de la victime s'exécute alors sans CSP. Surtout, à l'étape 1, cette même exclusion
  laissera passer sans contrôle toute requête `/app/...` ou `/admin/...` portant
  `purpose: prefetch`.
- **Règle enfreinte** : CLAUDE.md §4.6 et §4.3 (deny by default : ici c'est un *allow* par
  défaut piloté par le client).
- **Remédiation** : le `matcher` ne doit exclure que des chemins (`_next/static`, `_next/image`,
  `favicon.ico`), jamais des en-têtes. Les en-têtes de sécurité doivent être posés sur *toutes*
  les réponses, préfetch compris. Si un nonce par requête empêche de poser la CSP dans
  `next.config.ts`, il faut la poser dans le middleware **sans** condition `missing`.

### E2. `DJANGO_ADMIN_PATH` vide : `prod.py` démarre et publie l'admin Django à la racine du site

La question posée était : un déploiement peut-il retomber sur `/admin/` ? **Réponse : non pour le
cas « variable absente », oui pour le cas « variable vide », et le résultat est pire que `/admin/`.**

- **Emplacement** : `api/config/settings/base.py:22` (`default="admin"`),
  `api/config/settings/prod.py:20` (`env.str("DJANGO_ADMIN_PATH")`),
  `api/config/urls.py:10-15` (`path(f"{admin_path}/", admin.site.urls)`).

- **Preuve, variable absente — comportement correct** :

```
$ docker compose exec -T -e DJANGO_SETTINGS_MODULE=config.settings.prod ... api python -c "..."
REFUS: ImproperlyConfigured Set the DJANGO_ADMIN_PATH environment variable
```

- **Preuve, variable présente mais vide** (`DJANGO_ADMIN_PATH=` — la forme exacte que produit
  une ligne non renseignée dans un `.env`, un secret CI jamais rempli, une clé vide d'un
  ConfigMap) :

```
$ docker compose exec -T -e DJANGO_SETTINGS_MODULE=config.settings.prod -e DJANGO_ADMIN_PATH= ... api python -c "..."
DEMARRE. ADMIN_PATH= ''
['api/health', '/']

$ ... Client().get('/%2Flogin/', secure=True)
/%2Flogin/ -> 200
formulaire admin ? True | titre: <title>Connexion | Site d’administration de Django</title>
```

  Le formulaire de connexion de l'admin Django, avec son champ `id_username`, est servi en 200
  sur le domaine de production. La protection « chemin imprévisible » est intégralement annulée
  par une variable vide, et `prod.py` ne s'en aperçoit pas.

- **Impact** : surface d'attaque par force brute sur le compte administrateur unique du projet,
  exposée sur un chemin trivialement découvrable, sur un service dont le §3 dit qu'il ne doit
  même pas être joignable publiquement.
- **Règle enfreinte** : CLAUDE.md §4.6.
- **Aggravant** : `api/tests/test_security_baseline.py:52` teste `prod` en posant
  `DJANGO_ADMIN_PATH="chemin-secret"`. Aucun test ne couvre la chaîne vide, ni n'interdit la
  valeur `"admin"`. Le harnais donne donc une assurance qu'il ne fournit pas.
- **Remédiation** : valider la valeur, pas seulement sa présence — refuser vide, refuser
  `"admin"`, exiger une longueur minimale. Et retirer le `default="admin"` de `base.py` : un
  défaut dangereux dans le socle attend qu'un jour un troisième module de réglages oublie de le
  redéfinir.

---

## MOYEN

### M1. `api/apps/media/` est exclu du dépôt par `.gitignore` — le code qui signera les tokens Bunny échappera à toute relecture

- **Emplacement** : `.gitignore:27` (`media/`) contre `api/config/settings/base.py:45`
  (`"apps.media"` dans `LOCAL_APPS`).

- **Preuve** :

```
$ git check-ignore -v api/apps/media/apps.py
.gitignore:27:media/	api/apps/media/apps.py

$ git ls-files api/apps/ | grep -c media
0

$ git clone -q --branch etape-00-fondations . /tmp/clone && ls /tmp/clone/api/apps/
__init__.py  accounts  assessment  audit  catalog  certification  enrollment  learning
        ← media absent

$ docker run --rm -v /tmp/clone/api:/clone -w /clone python:3.12-slim \
    sh -c "pip install -q -e '.[dev]'; python manage.py check"
ModuleNotFoundError: No module named 'apps.media'
```

  Sur la machine de développement l'erreur est masquée : l'installation éditable résout
  `apps.media` vers `/app/apps/media`, la copie locale non versionnée
  (`apps: /clone/apps/__init__.py` mais `media: /app/apps/media/__init__.py`).

- **Impact** : trois conséquences. (a) Le critère déjà coché de `progress.md`
  « `docker compose up` fonctionne depuis un clone vierge » est **faux**. (b) La CI ne peut pas
  passer au vert, ce qui explique en partie pourquoi elle n'a jamais tourné. (c) Le plus grave
  pour moi : `apps/media` est l'application qui portera l'intégration Bunny et la signature des
  tokens de lecture (§4.1, le point le plus important du projet). Tant que cette règle
  d'ignorance est là, ce code ne sera ni commité, ni relu, ni passé au `ruff` bandit, ni couvert
  par les tests, ni vu par cette porte de sécurité.
- **Règle enfreinte** : CLAUDE.md §4.1 par ricochet, §8 (rien ne doit échapper à la porte).
- **Remédiation** : la règle visait le `MEDIA_ROOT` de Django (qui n'est d'ailleurs même pas
  configuré). L'ancrer : `/media/` ou `api/media/`, jamais `media/` global.

### M2. La page 404 de Django en `DEBUG` divulgue l'URLconf, chemin d'admin « imprévisible » compris

- **Preuve** :

```
$ curl -sS http://127.0.0.1:8000/nexistepas
Using the URLconf defined in config.urls,
Django tried these URL patterns, in this order:
    api/health   [name='health']
    change-moi-en-chemin-imprevisible/
```

- **Impact** : le secret du chemin d'admin ne survit pas à un `DEBUG=True`. En développement
  l'exposition est limitée à la boucle locale ; le risque réel est un environnement de
  recette monté avec `config.settings.dev` et publié.
- **Règle enfreinte** : CLAUDE.md §4.6.
- **Remédiation** : ne jamais faire dépendre la sécurité de l'admin de la seule discrétion du
  chemin — restreindre par le réseau ou par IP.

### M3. Le seul `docker-compose.yml` force `config.settings.dev`, et le fait par-dessus le `.env`

- **Emplacement** : `docker-compose.yml`, service `api` :

```yaml
    env_file: .env
    environment:
      DJANGO_SETTINGS_MODULE: config.settings.dev
```

  La clé `environment` l'emporte sur `env_file`. `DJANGO_SETTINGS_MODULE=config.settings.prod`
  posé dans un `.env` de production est **silencieusement ignoré**.
- **Impact** : c'est le chemin par lequel un déploiement retombe réellement sur `/admin/`,
  `DEBUG` à `True` et des cookies non `Secure` : tout le durcissement de `prod.py` est
  court-circuité, sans erreur ni avertissement. C'est aussi le seul fichier de composition qui
  existe — il n'y a pas d'alternative de production à ce jour.
- **Règle enfreinte** : CLAUDE.md §4.6.
- **Remédiation** : nommer le fichier `docker-compose.dev.yml` ou retirer le forçage, et faire
  échouer le démarrage si `DEBUG` est vrai alors que l'hôte n'est pas une adresse de boucle.

### M4. Dépendances Python figées sur une branche Django sortie du support

- **Emplacement** : `api/pyproject.toml:11` — `django==5.1.5` (janvier 2025).
- **Impact** : plusieurs versions correctives de sécurité de la branche 5.1 sont sorties après
  la 5.1.5, et la branche 5.1 n'est plus supportée. Le projet démarre donc sur un socle qui ne
  recevra plus de correctif.
- **Intuition, pas constatation** : je n'ai pas pu exécuter de scanner de vulnérabilités hors
  ligne côté Python (aucun `pip-audit` disponible dans l'image) ; je ne peux donc pas nommer un
  CVE exploitable ici avec certitude. C'est le principe qui est en cause, pas une exploitation
  démontrée.
- **Remédiation** : passer à la branche LTS supportée et ajouter `pip-audit` à la CI.

### M5. `style-src 'unsafe-inline'` dans la CSP

- **Emplacement** : `web/middleware.ts:17`.
- **Impact** : n'autorise pas d'exécution de script, mais ouvre l'exfiltration par CSS
  (sélecteurs d'attribut + `background-image`) et le détournement visuel par surcharge de style.
  À l'étape 4, le watermark du §4.1.4 est un élément **du DOM stylé en CSS** : `unsafe-inline`
  donnera à un attaquant qui trouve n'importe quelle injection HTML le moyen de le neutraliser
  visuellement sans toucher au DOM, donc sans déclencher le `MutationObserver`.
- **Remédiation** : styles porteurs du nonce, ou hachages. À trancher avant l'étape 4, pas après.

---

## FAIBLE

### F1. Bannière de version du serveur Django
`Server: WSGIServer/0.2 CPython/3.12.14` sur chaque réponse de `127.0.0.1:8000`. Divulgation de
version. Sans objet en production derrière gunicorn, à revérifier à ce moment-là.

### F2. Le mode développement de Next renvoie le source de `node_modules` dans le corps d'une erreur
`curl -H "next-router-prefetch: 1" http://localhost:3000/` renvoie un 500 dont la charge RSC
contient des fragments de code de `node_modules/next/dist/...` et l'arborescence `[project]/`.
Comportement de développement uniquement ; à revérifier sur un build de production.

### F3. La sonde de santé ment sur la nature de la panne
Base arrêtée : Django renvoie `503 {"status":"ok","db":"down"}` (`status` reste `ok`), et le
Route Handler Next traduit ce 503 en `{"status":"down","api":"unreachable"}` alors que l'API
répond parfaitement — `web/lib/api.ts:32-34` écrase tout non-2xx en `api_error`. Aucun impact de
sécurité : aucune trace, aucun nom de base, aucune URL interne ne fuit. C'est un défaut
d'exploitabilité opérationnelle.

---

## Ce qui a été vérifié et qui tient

Je le note parce que ce sont des points où j'ai cherché une faille et n'en ai pas trouvé.

- **Secrets dans le dépôt** : `git log -p --all` sur les trois commits ne contient qu'une valeur
  factice (`DJANGO_SECRET_KEY=cle-factice-de-developpement-a-remplacer` dans `.env.example`).
  Aucune clé privée, aucun mot de passe réel, aucun jeton d'API. `.env` est ignoré depuis le
  premier commit (`git check-ignore -v .env` → `.gitignore:2`) et n'a jamais été suivi.
  `SECRET_KEY` n'a **aucune** valeur par défaut (`base.py:17`) : une clé absente empêche le
  démarrage. Le job `secrets` de la CI vérifie l'absence de `.env` et passe `gitleaks`.
- **CORS** : aucun reflet d'origine. `Origin: https://evil.example` et `Origin: null` reçoivent
  une réponse **sans** `access-control-allow-origin` ; seule `http://localhost:3000` obtient
  `access-control-allow-origin: http://localhost:3000` avec `allow-credentials: true`.
  `CORS_ALLOW_ALL_ORIGINS = False` en dur dans `base.py:123`.
- **`ALLOWED_HOSTS`** : `Host: evil.example` → `400`, journalisé en `DisallowedHost`.
- **Exposition réseau** : `172.20.10.5:8000` (adresse LAN de l'hôte) → connexion refusée ;
  Django n'est joignable que par `127.0.0.1`, conformément à la publication
  `127.0.0.1:8000:8000`. PostgreSQL n'est publié sur aucun port (`5432` fermé depuis le LAN).
  `/admin/` → `404` (le chemin est bien déplacé par `DJANGO_ADMIN_PATH`).
- **Nonce de la CSP** : réellement différent à chaque requête (5 tirages, 5 UUID distincts),
  et propagé aux balises `<script>` et aux en-têtes `link`. La construction est correcte —
  ce sont ses deux voies de contournement (C1, E1) qui la rendent inutile.
- **Fuite de l'URL interne** : `grep "8000"` sur le HTML de `/` → 0 occurrence ;
  `api:8000`, `http://api`, `API_INTERNAL_URL` absents de la charge RSC. `web/lib/api.ts:37-39`
  avale bien le message d'erreur brut. Aucune variable `NEXT_PUBLIC_` ne porte l'URL de Django.
- **Panne de base provoquée** (`docker compose stop db`) : aucune trace, aucun nom de base,
  aucune chaîne de connexion ne remonte au client, ni par Next ni par Django.
- **Journalisation** : 729 lignes de `docker compose logs`, recherche de la valeur réelle de
  `DJANGO_SECRET_KEY`, de `POSTGRES_PASSWORD`, de `api:8000`, de `nonce-`, de `Authorization`
  et de `Cookie` → **aucune correspondance**.
- **Front** : aucun `dangerouslySetInnerHTML`, aucun `eval(`, aucun `innerHTML`.
- La base a été redémarrée et la pile est de nouveau opérationnelle :
  `{"status":"ok","api":"ok","db":"ok"}`.

---

## Non testé (avec la raison)

| Point | Raison |
|---|---|
| **1. IDOR** | Aucun modèle métier, aucune ressource portant un id, aucun compte. Rien à énumérer. |
| **3. Escalade de privilèges** | Aucun serializer, aucun endpoint d'écriture. Il n'existe aucun champ `is_staff`/`role`/`status` à injecter. |
| **4. Contournement de paywall** | Ni `Course`, ni `Chapter`, ni `is_free`, ni `Enrollment`. Aucun contenu payant n'existe. |
| **5. Vidéo** | Ni intégration Bunny, ni `PlaybackToken`, ni lecteur, ni watermark. |
| **6. Auth** | Aucun endpoint d'authentification, aucun `User`, aucune session, aucun rate limit à éprouver. |
| **7. Uploads** | Aucun endpoint de téléversement, aucun stockage. |
| **8. Injection (partiel)** | Testé côté statique : aucun champ texte libre, aucun filtre ni tri exposé, aucun rendu HTML non échappé. L'injection SQL et le XSS stocké seront testables à partir de l'étape 1. |

Ces sept points sont **NON TESTÉ**, pas « OK ». Ils devront être repassés intégralement dès
qu'une surface existera.

---

## Verdict

**PORTE FERMÉE.**

Deux constatations bloquantes de plein droit selon CLAUDE.md §8 :

- **C1 (CRITIQUE)** — `x-middleware-subrequest` désactive `web/middleware.ts` et supprime la CSP.
  Le composant vulnérable est celui auquel l'étape 1 confie la protection de `/app` et `/admin`.
- **E1 et E2 (ÉLEVÉ)** — le `matcher` du middleware s'exclut lui-même sur la foi d'en-têtes
  fournis par le client ; `DJANGO_ADMIN_PATH` vide monte l'admin Django sur le domaine de
  production, formulaire de connexion servi en 200.

S'ajoute **M1**, qui n'est pas une faille exploitable aujourd'hui mais qui met le futur code de
signature des tokens Bunny hors du dépôt, donc hors de cette porte : à corriger avant tout
travail sur `apps/media`.

**Décompte : 1 CRITIQUE · 2 ÉLEVÉ · 5 MOYEN · 3 FAIBLE.**

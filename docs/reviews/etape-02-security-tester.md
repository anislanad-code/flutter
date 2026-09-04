# Étape 02 — Rapport de sécurité

**Date** : 2026-09-04
**Cible** :
- API Django (dev, `DEBUG=1`) sur `http://127.0.0.1:8000`
- API Django rejouée avec `DJANGO_DEBUG=0` sur `http://127.0.0.1:8010` (vérif. traces/prod)
- Build de production Next.js (`next build` + `next start`) sur `http://localhost:3100`
- Seed `seed_course` : cours `flutter-firebase-debutants`, chapitre gratuit `installer-flutter-et-configurer-ton-editeur`, chapitres payants `ton-premier-widget`, `comprendre-le-hot-reload`.

**Comptes utilisés** : deux comptes créés via `POST /api/auth/register` (`pent-a@test.tld`, `pent-b@test.tld`), tous deux `PENDING` (aucun compte `ACTIVE` ni admin n'existe encore à cette étape — l'inscription payante et l'activation arrivent à l'étape 3). L'attaquant modélisé ici est donc le **visiteur anonyme** et le **compte `PENDING`**, ce qui correspond exactement au périmètre de l'étape 2.

**Ce qui a pu être testé** : la totalité des surfaces livrées par l'étape — les trois endpoints publics Django (`/api/public/course/{slug}`, `/api/public/chapters/{slug}`, `/api/public/leads`), la route Next `/api/public/leads`, le SSR de `/` et `/gratuit/[chapitre]`, le payload RSC/`__next_f`, le `ld+json`, `sitemap.xml`, `robots.txt`, les en-têtes.

**Ce qui n'a pas pu l'être** : points 1 (IDOR sur ressources par utilisateur), 5 (vidéo/token de lecture), 7 (uploads) — les ressources correspondantes (progression, tentatives, preuves, `PlaybackToken`, upload) n'existent pas encore. Détaillé en « Non testé ».

---

## Synthèse

| # | Point checklist | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | IDOR | Partiel | Aucune ressource par-utilisateur à cette étape ; le seul objet à id (`Lead`) n'a aucun endpoint de lecture | RAS (surface absente) |
| 2 | Fuite de contenu | Oui | Chapitre payant → 404 sec ; jamais de `transcript`/`video_provider_id`/`resources` d'un chapitre non gratuit, ni en JSON, ni en SSR, ni en RSC, ni en erreur | RAS |
| 3 | Escalade de privilèges | Oui | `is_staff`/`is_superuser`/`role`/`status`/`enrollment_status` ignorés au register ; `id`/`ip_prefix`/`is_staff` ignorés sur `leads` | RAS |
| 4 | Contournement de paywall | Oui | Chapitre payant inatteignable par API directe, route Next, SSR, RSC, sitemap, message d'erreur (404 identique à un chapitre inexistant, DEBUG on/off) | RAS |
| 5 | Vidéo | Non | Pas de token de lecture ni d'URL Bunny à cette étape | Non testé |
| 6 | Auth | Oui | Pas d'énumération (login), pas d'escalade ; **rate-limit `leads` contournable par en-tête client** | MOYEN |
| 7 | Uploads | Non | Aucun upload à cette étape | Non testé |
| 8 | Injection | Oui | Transcript/ressources correctement échappés/neutralisés par React ; **`ld+json` breakable par `</script>`** (latent, mitigé par CSP nonce) | MOYEN |
| 9 | En-têtes & config | Oui | CSP nonce + strict-dynamic, HSTS/nosniff/XFO/Referrer présents, CORS liste blanche sans reflet, `DEBUG=0` sans trace | FAIBLE |
| 10 | Journalisation | Oui | Aucun secret/token/cookie dans les logs (pas de secret manipulé à cette étape) | RAS |

---

## CRITIQUE

Aucune.

## ÉLEVÉ

Aucune.

---

## MOYEN

### M1. Limite de débit de `POST /api/public/leads` contournable par en-tête client `X-Forwarded-For`

- **Emplacement** : `web/lib/client-ip.ts:5-9` (`ipDuVisiteur`) et `api/apps/accounts/utils.py:14-19` (`get_client_ip`) — les deux prennent la valeur **la plus à gauche** de `X-Forwarded-For`, qui est celle revendiquée par le client. Consommé par `api/apps/catalog/views.py:69-73`.
- **Preuve** :

```
# 5 tirs même IP -> le 6e est bloqué (contrôle nominal OK)
$ for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} " -X POST \
    http://localhost:3100/api/public/leads -H 'Content-Type: application/json' \
    -H 'X-Forwarded-For: 4.4.4.4' -d '{"email":"n@b.tld","form_rendered_at":0}'; done
201 201 201 201 201 429 429 429

# même volume, en incrémentant un octet du XFF à chaque tir -> jamais bloqué
$ for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} " -X POST \
    http://localhost:3100/api/public/leads -H 'Content-Type: application/json' \
    -H "X-Forwarded-For: 5.5.5.$i" -d '{"email":"n2@b.tld","form_rendered_at":0}'; done
201 201 201 201 201 201 201 201     # 8 leads créés (confirmé en base)
```

- **Impact** : un bot insère un nombre illimité de leads (spam de la table, empoisonnement de la future liste d'attente / des futurs emails), la limite « 5/h/IP » annoncée pour l'étape n'existe pas en pratique. Les proxys standards **ajoutent** l'IP réelle à droite de `X-Forwarded-For` ; prendre l'élément de gauche = faire confiance à une valeur que le client écrit lui-même.
- **Règle enfreinte** : §4.2 (rate limiting « réellement effectif par IP ») appliqué à l'anti-bot de l'étape 2 (progress.md étape 2, « rate limit 5/h/IP »).
- **Remédiation** : dériver l'IP d'une source de confiance — au bord (Next), prendre l'IP de connexion réelle (`request.ip`/dernier hop) et non le XFF revendiqué ; au niveau Django, compter depuis la droite de `X-Forwarded-For` en fonction du nombre de proxys de confiance connus, pas depuis la gauche.

### M2. Anti-bot « délai minimum » contournable par un `form_rendered_at` fourni par le client

- **Emplacement** : `api/apps/catalog/services.py:24-26` — `ecoule_ms = now - form_rendered_at`, rejette si `< 1500`. `form_rendered_at` vient du corps de requête (client).
- **Preuve** :

```
# horodatage ancien -> "écoulé" énorme -> passe la barrière
$ curl ... -d '{"email":"vieux-ts@x.tld","form_rendered_at":1}'
=> Lead "vieux-ts@x.tld" : cree
```

(Le honeypot rempli et un horodatage *futur* sont bien rejetés — ces deux branches fonctionnent.)

- **Impact** : le contrôle « soumission plus rapide qu'un humain » ne coûte rien à un bot qui envoie simplement un `form_rendered_at` ancien. Combiné à M1, l'endpoint `leads` n'a plus aucune protection anti-abus effective.
- **Règle enfreinte** : progress.md étape 2 (« anti-bot : honeypot + délai minimum de soumission »).
- **Remédiation** : ne pas faire reposer le délai sur une valeur client ; poser l'instant de rendu côté serveur (jeton signé/horodaté émis au chargement du formulaire, ou champ en session), ou traiter le délai comme un signal faible parmi d'autres et non comme une barrière.

### M3. Latent : `<script type="application/ld+json">` cassable par `</script>` dans le contenu du cours

- **Emplacement** : `web/app/(marketing)/page.tsx:44-59` — `dangerouslySetInnerHTML={{ __html: JSON.stringify({... name: cours.title, description: cours.description ...}) }}`. `JSON.stringify` n'échappe pas `<`, `>` ni la séquence `</script>`.
- **Preuve** : en injectant en base `course.description = "Formation </script><script>alert(document.domain)</script> suite"`, le SSR rend la séquence **telle quelle**, fermant la balise `ld+json` :

```
<script type="application/ld+json" nonce="...">{"@context":"https://schema.org",
"@type":"Course","name":"Titre <img src=x onerror=alert(1)>",
"description":"Formation </script><script>alert(document.domain)</script> suite",...}</script>
```

- **Portée réelle / mitigation** : à cette étape, `Course.title`/`description` ne sont écrits que par le seed ou l'admin Django — pas de chemin d'écriture public. De plus la **CSP à nonce + `strict-dynamic`** (`web/middleware.ts:17`) empêche l'exécution du `<script>` injecté (il n'a pas de nonce) et des gestionnaires inline (`onerror`). L'exploitation directe est donc bloquée aujourd'hui. Mais l'échappement manquant est une faute par construction : dès qu'une donnée moins fiable atteindra `Course.title`/`description` (import, futur back-office, autre formation), ou si la CSP est un jour assouplie, c'est un XSS stocké.
- **Règle enfreinte** : §4.4 (rendu de contenu), §7 (« pas de confiance aveugle dans la forme des données »). Le commentaire du code affirme « texte JSON statique … jamais de saisie libre » — c'est une hypothèse, pas une garantie technique.
- **Remédiation** : échapper `<`/`>`/`&`/`U+2028`/`U+2029` avant injection (p. ex. remplacer `<` par `<` dans la chaîne JSON), technique standard pour le JSON-LD embarqué. Ne pas dépendre de la seule CSP.

**Note positive vérifiée** : le reste du rendu de contenu est sûr. `web/lib/markdown-leger.ts` produit des éléments React (jamais `dangerouslySetInnerHTML`) ; un transcript contenant `<img src=x onerror=...>`, `<script>alert(2)</script>`, `<svg onload=...>` ressort **échappé** (`&lt;img …&gt;`). Les `resources[].url` en `javascript:`/`data:` sont neutralisés par React (`href="javascript:throw new Error('React has blocked a javascript: URL…')"`). Le `video_provider_id` piégé ressort échappé dans l'attribut `src`.

---

## FAIBLE

### F1. En-tête `Server: WSGIServer/0.2 CPython/3.12.3`

- **Preuve** : `curl -sD- http://127.0.0.1:8010/api/health | grep -i server` → `Server: WSGIServer/0.2 CPython/3.12.3`.
- **Portée** : serveur de dev ; en production Django n'est pas exposé (§3) et tourne derrière gunicorn/Next. Divulgation de version, aucun impact direct. À vérifier que le serveur de prod (gunicorn) ne réémet pas de bannière de version.

### F2. `CORS_ALLOW_CREDENTIALS = True` avec des endpoints publics non authentifiés

- **Emplacement** : `api/config/settings/base.py:153`. La liste blanche d'origines est correcte (`CORS_ALLOW_ALL_ORIGINS = False`, aucune origine reflétée — vérifié : `Origin: https://evil.tld` ne reçoit aucun `Access-Control-Allow-*`). Point de durcissement seulement : autoriser les credentials n'est pas nécessaire pour les routes `/api/public/*` qui n'utilisent pas de cookie. Sans conséquence tant que la liste d'origines reste stricte.

---

## Détail des points passés au vert (preuves)

**Point 4 — paywall (priorité de l'étape).** Chapitre payant inaccessible par tous les chemins :

```
GET /api/public/chapters/ton-premier-widget            -> 404 {"detail":"Non trouvé."}
GET /api/public/chapters/zzz-inconnu (inexistant)      -> 404   (réponses non identiques au niveau
   du corps : "Non trouvé." vs "No Chapter matches…", voir ci-dessous)
GET /gratuit/ton-premier-widget (SSR prod)             -> 404, HTML identique à un slug inexistant
POST/PUT/PATCH/DELETE sur le chapitre                  -> 405
variations (/, casse, ?is_free=true, id numérique)     -> 404
sitemap.xml                                            -> ne liste QUE le chapitre gratuit
```

Le contenu payant (`transcript`, `video_provider_id`, `resources`, titres des chapitres payants au-delà de la structure) n'apparaît ni dans le SSR de `/gratuit/*`, ni dans le payload RSC. La structure du cours (`/api/public/course/{slug}`) expose bien titres/résumés/`is_free` mais **jamais** de champ de `Lesson` (serializer `ChapterSummarySerializer` sans `lesson`). Le compte `PENDING` n'obtient rien de plus que l'anonyme (l'endpoint est `AllowAny`, la décision ne dépend que de `is_free`).

> **Observation (défense en profondeur, non bloquante)** : le corps du 404 diffère légèrement entre un chapitre **payant existant** (`{"detail":"Non trouvé."}`, levé par `raise Http404` dans la vue) et un **slug inexistant** (`{"detail":"No Chapter matches the given query."}`, levé par `get_object_or_404`). C'est un micro-oracle d'existence au niveau du **corps** — le code HTTP et le temps de réponse sont identiques (mesuré : ~14–17 ms dans les deux cas, `DEBUG=0`), et côté SSR Next les deux rendent un 404 strictement identique, donc l'oracle ne franchit pas la frontière publique. À aligner tout de même (renvoyer un `Http404` sans message, ou le même message dans les deux branches) pour respecter à la lettre le §4.3 « ne pas confirmer l'existence ». Classé **FAIBLE / durcissement**.

**Point 3 — escalade.** `POST /api/auth/register` avec `is_staff:true,is_superuser:true,role:"admin",status:"ACTIVE",enrollment_status:"ACTIVE"` → compte créé `is_staff=False`, `is_superuser=False`, `Enrollment=PENDING`. Mass-assignment sur `leads` (`id`, `ip_prefix`, `is_staff`, `created_at`) → ignoré (`id` auto, `ip_prefix` recalculé serveur à `127.0.0`).

**Point 9 — config.** `DEBUG=0` : erreurs propres, aucune stacktrace (`JSON parse error…`, `{"form_rendered_at":["…"]}`, 404 HTML minimal). CSP posée par middleware avec nonce + `strict-dynamic` (pas de `unsafe-inline` en `script-src`). CVE-2025-29927 (`x-middleware-subrequest`) ne désactive pas le middleware : la CSP reste présente. HSTS/`nosniff`/`X-Frame-Options: DENY`/`Referrer-Policy` présents. CORS sans reflet d'origine.

---

## Non testé (avec raison)

- **Point 1 (IDOR par utilisateur)** : aucune ressource rattachée à un utilisateur n'existe à l'étape 2 (progression, tentatives, preuves, certificats, tokens arrivent aux étapes 3–8). Le seul modèle à id introduit ici, `Lead`, n'a **aucun** endpoint de lecture/liste — non atteignable par id. À repasser intégralement dès l'étape 3 (preuve de paiement).
- **Point 5 (vidéo/token)** : `PlaybackToken`, endpoint `playback`, URL Bunny et watermark n'existent qu'à l'étape 4. Le `LecteurVideo` actuel n'affiche encore aucune vidéo (`video_provider_id` vide dans le seed). Non applicable.
- **Point 7 (uploads)** : le téléversement de preuve de paiement (magic bytes, réencodage, bucket privé) est l'objet de l'étape 3. Aucune surface d'upload à cette étape.
- **Point 10 (journalisation de secrets)** : aucun secret/token/cookie/URL signée n'est manipulé par les fonctionnalités de l'étape (endpoints publics sans auth). Rien à faire fuiter dans les logs ici ; à re-vérifier dès qu'un flux authentifié ou une URL signée apparaît (étapes 3–4).

---

## Verdict

**PORTE FERMÉE** au sens strict du profil ? **Non — PORTE OUVERTE.**

Aucune constatation **CRITIQUE** ni **ÉLEVÉE**. Le contournement de paywall (priorité de l'étape, point 4) et la fuite de contenu (point 2) sont **fermés sur tous les chemins testés**, y compris le SSR de production et le payload RSC. L'escalade de privilèges et la config sont propres.

Restent **3 MOYEN** (rate-limit `leads` et délai anti-bot contournables par en-tête/champ client ; `ld+json` non échappé mais aujourd'hui neutralisé par la CSP nonce) et **2 FAIBLE**. Aucun ne bloque l'étape selon la règle §8, mais M1 et M2 vident de sens l'anti-abus annoncé pour l'endpoint `leads` et devraient être corrigés avant la mise en production ; M3 est une dette à solder avant que du contenu de cours moins fiable ne soit importé.

**Décompte : CRITIQUE 0 · ÉLEVÉ 0 · MOYEN 3 · FAIBLE 2.**

# Étape 03 — Rapport de sécurité

**Date** : 2026-09-04
**Cible** :
- BFF Next sur `http://localhost:3000` (canal navigateur)
- API Django (dev, `DEBUG=True`) sur `http://127.0.0.1:8000` (debug local uniquement)
- Docker Compose UP (`api`, `web`, `db`, `purge`)
- Seed : cours `flutter-firebase-debutants`, chapitre gratuit `installer-flutter-et-configurer-ton-editeur`, chapitres payants `ton-premier-widget`, `variables-et-types`, …

**Comptes utilisés** (créés pour ce pentest, plus l'admin déjà en base) :
- Étudiant A `PENDING` : `penta-1788536584@test.tld` (téléphone XSS `<img src=x onerror=alert(1)>`, inscription `id=4`, preuve `1c3ac2f1-f090-41db-b21a-d5ccf42ca713`) — mot de passe d'origine invalidé en fin de test (voir E2)
- Étudiant B `PENDING` puis `ACTIVE` via l'admin : `pentb-1788536584@test.tld` (inscription `id=5`, preuve EXIF `f8938379-9cc4-45fc-ba4f-4f546c56ed21`)
- Étudiant C `PENDING` : `pentc-1788536729@test.tld` (preuve polyglotte `3cdb5191-cc87-4ab3-b7c5-91cf66826bb6`)
- Admin : `anis@example.com` / `mot-de-passe-admin-789` (`is_staff=true`, `id=2`)

**Ce qui a pu être testé** : checklist §8 points 1–10 sur la surface de l'étape 3 (preuves de paiement, paywall `PENDING`/`ACTIVE`, file admin, URL signée, uploads, IDOR, escalade, auth, en-têtes, journaux). Priorité 1, 4, 7 exercées de bout en bout, BFF **et** Django direct.

**Ce qui n'a pas pu l'être** : tokens de lecture Bunny / watermark / session unique (étape 4) ; IDOR sur progression, tentatives de QCM, certificats (endpoints absents) ; instance Django `DEBUG=0` dédiée (contrairement à l'étape 2). Détaillé en « Non testé ».

---

## Synthèse

| # | Point checklist | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | IDOR | Oui (preuves, inscriptions, file admin) | A → ressources de B / routes admin : **404**, jamais 403. Queries `?user_id=` ignorées. UUID non séquentiel | RAS |
| 2 | Fuite de contenu | Oui | Pas de `file_key`, pas d'`is_correct`, pas d'URL vidéo. Chapitre payant 404 bit-à-bit identique à un slug inexistant. Titres payants dans l'arbre public : prévu | RAS |
| 3 | Escalade de privilèges | Oui | `is_staff` / `role` / `status` / `enrollment_status` / `ACCEPTED` ignorés à l'inscription, au dépôt et à l'acceptation | RAS |
| 4 | Contournement de paywall | Oui | `PENDING` : chapitre payant inatteignable (Django public, Django privé, SSR `/app/chapitre`, `/gratuit`, sitemap, erreurs). `ACTIVE` (B) : contenu servi. Playback / progress : absents | RAS |
| 5 | Vidéo | Non (surface absente) | Pas d'endpoint `/api/lessons/{id}/playback`. `video_provider_id` vide même pour un `ACTIVE` | Non testé |
| 6 | Auth | Oui | Pas d'énumération login/register/reset. Rate-limit compte 5/15 min réel (6e → 429). Rejeu de refresh : famille entière tombée. Cookies HttpOnly + SameSite=strict. **XFF gauche toujours crédible** | MOYEN |
| 7 | Uploads | Oui | SVG, PHP-as-jpg, HTML-as-jpg, GIF, PDF/JS, vide, 6 Mo → refus. EXIF et polyglotte JPEG+HTML détruits au réencodage. Path traversal : nom ignoré, UUID. URL signée : session admin **et** HMAC, sinon 404/401. Fichier hors URL : 404 | RAS sur le pipeline §4.5 ; **ÉLEVÉ** sur la journalisation de l'URL signée (point 10) |
| 8 | Injection | Oui | Filtre `?status=` en allow-list (400). XSS téléphone / motif de refus échappés en SSR (`&lt;img…`). Pas de `dangerouslySetInnerHTML` sur ces champs | RAS |
| 9 | En-têtes & config | Oui | CSP nonce sur le BFF, nosniff / XFO / Referrer. CORS sans `Access-Control-Allow-Origin` pour `https://evil.tld`. `/admin/` Django → 404. Admin Django joignable au chemin d'exemple en local. **CSP sandbox de l'aperçu écrasée par le middleware** | MOYEN |
| 10 | Journalisation | Oui | Access log Django enregistre `?expires=&signature=`. Le backend console imprime le jeton de reset en clair dans stdout — **confirmé exploitable** (204 + ancien mot de passe rejeté) | **ÉLEVÉ** |

---

## CRITIQUE

Aucune.

## ÉLEVÉ

### E1. URLs signées de preuves CCP écrites en clair dans les journaux d'accès Django

- **Emplacement** : journal d'accès de `runserver` (ligne de requête WSGI, query string complète). La vue `AdminProofFileView` (`api/apps/enrollment/views.py`) sert `/api/admin/proofs/<uuid>/file?expires=&signature=`. Le BFF (`web/app/api/admin/proofs/[id]/apercu/route.ts`) va chercher ce chemin en interne, précisément pour que le navigateur ne le voie jamais — les logs Django, eux, le voient.
- **Preuve** :

```
$ docker compose logs api | rg 'proofs/.*/file\?expires='
api-1  | [04/Sep/2026 16:46:05] "GET /api/admin/proofs/f8938379-9cc4-45fc-ba4f-4f546c56ed21/file?expires=1788537365&signature=8abca03ac28fe3eee3f081a1d3f31b233871447d6d176dc6aa12df615a2d59c3 HTTP/1.1" 200 296
api-1  | [04/Sep/2026 16:46:06] "GET /api/admin/proofs/f8938379-9cc4-45fc-ba4f-4f546c56ed21/file?expires=1788537366&signature=d6d0a6cb96d12a090bf9f535b32eba34ad8f76ddf4327ba4f246b01c31c432a0 HTTP/1.1" 200 296
api-1  | [04/Sep/2026 16:48:35] "GET /api/admin/proofs/3cdb5191-cc87-4ab3-b7c5-91cf66826bb6/file?expires=1788537514&signature=63f4a93a6bc4fae0d926497ddd7b97a2ef2c0ff614fd23fd267694df3c356e6f HTTP/1.1" 200 296
```

La signature HMAC et l'instant d'expiration d'une preuve CCP (donnée personnelle, §4.5) sont donc dans stdout, donc dans `docker compose logs`, donc dans n'importe quel agrégateur qui reprend ce flux. En production, le format d'accès Gunicorn/uvicorn par défaut fait la même chose.

Contrôle d'exploitation **en aval** (la signature seule ne suffit pas) :

```
# sans session
GET http://127.0.0.1:8000/api/admin/proofs/<id>/file?expires=…&signature=…
→ 401 {"detail":"Informations d'authentification non fournies."}

# session étudiant A + URL signée de B
→ 404 {"detail":"Non trouvé."}

# expires=1 (passé) + bonne signature, session admin
→ 404 {"detail":"Non trouvé."}

# signature tronquée / proof_id substitué
→ 404 {"detail":"Non trouvé."}
```

- **Impact** : un accès aux logs (poste de dev partagé, CI, agrégateur) conserve pendant 10 minutes une autorisation de lecture d'un reçu CCP, à condition de disposer **aussi** d'une session admin. Ce n'est pas encore un vol de fichier depuis un compte étudiant, mais c'est exactement ce que §4.6 interdit d'écrire.
- **Règle enfreinte** : CLAUDE.md §4.6 (« Les journaux ne contiennent jamais : … URLs signées ») et §4.5 (consultation journalisée, pas l'URL elle-même).
- **Remédiation** : ne jamais journaliser la query string de `/file`. Format d'accès du type `%(m)s %(U)s` (path sans query) ou filtre qui retire `signature` / `expires`. L'`AuditLog` `PROOF_VIEWED` suffit comme trace.

### E2. Jeton de réinitialisation imprimé dans stdout — prise de contrôle du compte A

- **Emplacement** : `api/apps/accounts/emails.py:24-31` construit `…/nouveau-mot-de-passe?token={token}` et l'envoie via `send_mail`. En local, `EMAIL_BACKEND` vaut `django.core.mail.backends.console.EmailBackend` (`api/config/settings/dev.py:12`) : le message — donc le jeton — sort sur stdout, mélangé aux access logs.
- **Preuve** :

```
# 1. Demande de reset pour A (message générique, OK)
POST http://localhost:3000/api/auth/password-reset/request
{"email":"penta-1788536584@test.tld"}
→ 200 {"detail":"Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé."}

# 2. Le jeton est dans docker compose logs api
api-1  | http://localhost:3000/nouveau-mot-de-passe?token=3GePJN6bZxBoNXMAvkm5MV6U6KLMpJsqHq7iJ40TIe0

# 3. Confirmation avec ce jeton
POST http://localhost:3000/api/auth/password-reset/confirm
{"token":"3GePJN6bZxBoNXMAvkm5MV6U6KLMpJsqHq7iJ40TIe0","password":"NouveauMotDePasse-Pentest-2026!"}
→ 204 No Content

# 4. L'ancien mot de passe ne passe plus
POST http://localhost:3000/api/auth/login
{"email":"penta-1788536584@test.tld","password":"PentestEtudiantA-2026!"}
→ 401 {"detail":"Email ou mot de passe incorrect."}
```

- **Impact** : quiconque lit `docker compose logs` (ou un fichier qui agrège stdout) réinitialise n'importe quel compte dont un reset a été demandé — y compris l'admin, si quelqu'un déclenche un reset sur `anis@example.com`. Ce n'est pas le chemin d'un étudiant `PENDING` sans accès machine ; c'est un secret d'authentification dans les journaux, interdit par §4.6. Classé ÉLEVÉ et non CRITIQUE : l'attaquant-étudiant du modèle de menace n'a pas stdout.
- **Règle enfreinte** : CLAUDE.md §4.6 (tokens dans les journaux) ; §4.2 (jeton de reset à usage unique — ici il l'est, mais il fuit avant usage).
- **Remédiation** : même en console, ne pas écrire le jeton brut dans un flux mélangé aux access logs (fichier outbox dédié, ou message rédigé `token=***`). En production, un backend SMTP ne doit jamais logger le corps. Vérifier que Gunicorn/Sentry ne capturent pas non plus le contenu des emails.

---

## MOYEN

### M1. `X-Forwarded-For` toujours pris à gauche — la limite `proof:ip` n'existe pas en pratique

- **Emplacement** : `web/lib/client-ip.ts:5-9` (`ipDuVisiteur`) et `api/apps/accounts/utils.py:14-19` (`get_client_ip`). Consommé par `PaymentProofUploadView` (`api/apps/enrollment/views.py:77-82`, `proof:ip` 20/h). Inchangé depuis l'étape 2 (M1 de `docs/reviews/etape-02-security-tester.md`).
- **Preuve** : le BFF de dépôt recopie l'en-tête client (`web/app/api/enrollment/proof/route.ts:65` : `"X-Forwarded-For": ipDuVisiteur(request)`). La primitive est la même que celle qui, à l'étape 2, a créé 8 leads d'affilée en incrémentant un octet. Non ré-épuisé à 20 dépôts cette session (plafond 10/h/user atteint plus tôt que 20/h/IP) ; le code path est identique et maintenant branché sur une donnée sensible (§4.5).
- **Impact** : un bot de dépôts de reçus (spam de la file admin, DoS du pipeline Pillow) contourne `proof:ip` en revendiquant une IP différente à chaque POST. `proof:user` (10/h, clé = `user.pk`) reste un filet par compte authentifié.
- **Règle enfreinte** : §4.2 (rate limiting réellement effectif par IP), étendu au dépôt de preuve.
- **Remédiation** : inchangée depuis l'étape 2 — dériver l'IP du hop de confiance, pas du XFF gauche.

### M2. Le garde 5 Mo du BFF s'exécute après que Next a accepté le `Content-Length`

- **Emplacement** : `web/app/api/enrollment/proof/route.ts:25-31` lit `content-length` **dans** le Route Handler. Le parseur HTTP de Next attend d'avoir le corps (ou d'attendre indéfiniment s'il manque des octets) avant d'appeler ce code.
- **Preuve** :

```
# Fichier réel 6 Mo, BFF — le handler finit par 413 (après réception)
POST http://localhost:3000/api/enrollment/proof  (multipart 6 MiB)
→ 413 {"detail":"Le fichier dépasse 5 Mo. Envoie une capture plus légère."}

# Content-Length: 104857600 avec un tout petit multipart : le handler Next
# n'a pas répondu dans la fenêtre du test (requête tuée à ~40 s, toujours ouverte).

# Django, session valide, même Content-Length 100 Mo, body minuscule :
POST /api/enrollment/proof  Content-Length: 104857600
→ 413 {"detail":"Le fichier dépasse 5 Mo."}   # la vue lit META["CONTENT_LENGTH"] avant request.data

# Django, fichier réel 6 Mo :
→ 413 {"detail":"Le fichier dépasse 5 Mo."}
```

- **Impact** : en production le navigateur parle au BFF, pas à Django. Un client qui envoie ou **annonce** 100 Mo occupe un worker Next. Ce n'est pas un contournement de paywall, c'est une absence de plafond au bord.
- **Règle enfreinte** : §4.5 (taille max 5 Mo — le refus doit être bon marché).
- **Remédiation** : limiter `bodyParser` / taille de la Function (Vercel `request.body` size, ou reverse-proxy `client_max_body_size`) **avant** le Route Handler. Django est déjà correct.

### M3. La CSP `sandbox` de l'aperçu admin est écrasée par le middleware

- **Emplacement** : `web/app/api/admin/proofs/[id]/apercu/route.ts:75-83` pose `Content-Security-Policy: default-src 'none'; sandbox` et `Content-Disposition: inline` pour les images. `web/middleware.ts:51-59` réécrit `Content-Security-Policy` sur **toutes** les réponses matchées, y compris cette route.
- **Preuve** (même fichier, deux canaux) :

```
# Django /file (ce que le BFF est censé relayer)
Content-Type: image/jpeg
Content-Disposition: attachment; filename="preuve-f8938379-…"
Content-Security-Policy: default-src 'none'; sandbox
X-Content-Type-Options: nosniff
Cache-Control: no-store, private

# BFF /apercu (ce que le navigateur admin reçoit)
content-type: image/jpeg
content-disposition: inline
content-security-policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic' 'unsafe-eval'; …
cache-control: no-store, private, max-age=0
X-Content-Type-Options: nosniff
```

Le JPEG réencodé + `nosniff` empêche l'exécution aujourd'hui (polyglotte HTML détruit, EXIF vide — voir point 7). La défense en profondeur prévue par la route n'est pas celle qui arrive au navigateur.
- **Impact** : si un jour un type mal classé passait le pipeline, il s'afficherait dans l'origine du site sous la CSP des pages (`script-src` avec nonce + `unsafe-eval` en dev), pas sous `sandbox`.
- **Règle enfreinte** : §4.5 / §4.6 (CSP stricte sur une ressource sensible).
- **Remédiation** : exclure `/api/admin/proofs/` du `matcher` middleware, ou ne pas `set` la CSP documentaire par-dessus une CSP déjà posée par la route.

---

## FAIBLE

### F1. `DEBUG=True` en local divulgue le URLconf, y compris le chemin « imprévisible » de l'admin Django

`GET http://127.0.0.1:8000/this-path-does-not-exist` → HTML Django « Page not found », `DEBUG = True`, liste `api/`, `api/public/`, `change-moi-en-chemin-imprevisible/`.
`GET http://127.0.0.1:8000/admin/` → 404 (pas le chemin par défaut).
`GET http://127.0.0.1:8000/change-moi-en-chemin-imprevisible/` → 302 vers `/login/`.

Attendu en dev. Serait ÉLEVÉ si `DJANGO_DEBUG=1` partait en production (`prod.py` force `DEBUG = False` — non rejoué sur un port 8010 cette fois). Le chemin d'exemple est celui de `.env.example`.

### F2. Cookies d'auth sans flag `Secure` sur localhost

```
set-cookie: session=…; Path=/; Max-Age=900; HttpOnly; SameSite=strict
set-cookie: refresh=…; Path=/; Max-Age=604800; HttpOnly; SameSite=strict
```

`httpOnly` et `SameSite=strict` présents. `Secure` absent (`web/lib/auth-cookies.ts`, `estProd = NODE_ENV === "production"`). Cohérent avec HTTP local ; à vérifier sur un `next start` de production.

### F3. `script-src` contient `'unsafe-eval'` en développement

CSP du BFF (middleware, `estDev`). Absent du brief de production. Ne pas laisser passer dans le build prod.

### F4. `/api/me` et la réponse de login exposent `is_staff`

```
{"id":4,"email":"penta-…","phone":"<img src=x onerror=alert(1)>","is_staff":false,…}
```

Lecture seule, pas d'affectation depuis le client (register avec `"is_staff":true` → compte créé `is_staff:false`). Informational.

### F5. Routes admin : 401 sans cookie, 404 avec session étudiante

Non-authentifié sur `/api/admin/enrollments` → `401 {"detail":"Informations d'authentification non fournies."}` (volontaire, pour le refresh BFF). Étudiant authentifié → `404 {"detail":"Non trouvé."}`. L'existence de la famille `/api/admin/` est confirmée à un client anonyme, pas son contenu.

---

## Preuves de ce qui **tient** (priorités 1, 4, 7)

### IDOR (point 1) — 404, pas 403

```
# A, cookie étudiant
GET http://127.0.0.1:8000/api/admin/enrollments                    → 404 {"detail":"Non trouvé."}
POST /api/admin/enrollments/5/accept                               → 404
GET /api/admin/proofs/f8938379-…/url                               → 404
GET /api/admin/proofs/f8938379-…/file?expires=…&signature=…        → 404
GET http://localhost:3000/api/admin/proofs/<uuid B>/apercu         → 404 {"detail":"Introuvable."}
GET /api/enrollment/status?user_id=5&enrollment_id=5               → 200, *sa* inscription (ANISDEV-000004), pas celle de B
```

BFF `/admin` et `/admin/inscriptions` avec la session de A rendent le parcours étudiant (redirect `is_staff`), aucun email tiers.

### Paywall (point 4)

| Chemin | PENDING A | ACTIVE B |
|---|---|---|
| `GET /api/public/chapters/ton-premier-widget` | 404 `{"detail":"Non trouvé."}` identique au slug fantôme | 404 (route publique = `is_free` only) |
| `GET /api/chapters/ton-premier-widget` + cookie | 404 identique au slug `chapitre-qui-nexiste-pas-xyz` | 200 titre + leçon (transcript vide en seed) |
| SSR `/app/chapitre/ton-premier-widget` | 404 Next | 200 « Ton premier widget : Hello Algérie » |
| SSR `/gratuit/ton-premier-widget` | 404 | 404 |
| `sitemap.xml` | uniquement `/` et le chapitre `is_free` | idem |
| `POST /api/lessons/1/playback` | 404 (n'existe pas) | 404 |

`PENDING` A après activation de B : toujours 404 sur le payant. Payload `{"status":"BLOCKED"}` sur `accept` : inscription B quand même `ACTIVE`.

### Uploads (point 7)

| Payload | Canal | Résultat |
|---|---|---|
| SVG + `<script>`, nommé `.svg` ou `.jpg` + `Content-Type: image/jpeg` | BFF | 400 *Format non accepté…* |
| `<?php system($_GET['c']); ?>` en `.jpg` | BFF | 400 même message |
| HTML en `.jpg` | BFF | 400 |
| GIF | BFF | 400 |
| PDF avec `/OpenAction` `/JavaScript` | BFF | 400 *éléments actifs* |
| Fichier vide | BFF | 400 *Choisis une capture* |
| 6 Mo aléatoire | BFF / Django | 413 |
| JPEG valide, filename `../../etc/passwd` | BFF | **201** *Reçu envoyé.* (nom ignoré) |
| JPEG + EXIF `CCP-SECRET-987654321` et Artist `<?php…?>` | Django + `status=ACCEPTED` | 201 `{"id":"…","status":"SUBMITTED"}` — pas ACCEPTED |
| JPEG + HTML concaténé (polyglotte) | Django | 201, `byte_size: 296` (original 720) |

EXIF / polyglotte après téléchargement admin :

```
original EXIF : {315: "<?php system('id'); ?>", 270: "CCP-SECRET-987654321 EXIF_PAYLOAD"} (759 o)
téléchargé /file et /apercu : 296 o, magic JPEG, exif {}, charge utile absente
polyglotte téléchargé : 296 o, <html> / <?php / <script> absents
```

Stockage : `/app/.preuves-privees/<32 hex>.bin`, tête Fernet `gAAAAABq…`, mode `0o600`, zéro fichier avec magic JPEG en clair. `GET /.preuves-privees/` → 404.

Double dépôt A : `409 {"detail":"Ton reçu est déjà en cours de vérification."}`

---

## Non testé (avec raison)

- **Point 5 — vidéo** : pas d'endpoint de playback, pas de token Bunny, pas de lecteur watermark. `video_provider_id` est une chaîne vide dans la leçon du chapitre payant servi à B. À l'étape 4.
- **Point 1 — progression / QCM / certificats / PlaybackToken** : routes absentes (`GET /api/progress`, `/api/attempts`, `/api/certificates` → 404 HTML DEBUG). IDOR des **preuves** et des **inscriptions** : testé.
- **Django `DEBUG=0` / Next `next start`** : non rejoué sur un second port cette session. `prod.py` lit `DEBUG = False`, HSTS 1 an, `DJANGO_ADMIN_PATH` interdit d'être `admin`. Les traces DEBUG ci-dessus sont celles du compose local.
- **Envoi réel d'un corps 100 Mo** jusqu'au BFF : non poussé (DoS du worker de dev). Annonce `Content-Length: 104857600` + petit body : suffisante pour M2.
- **DRM / referrer Bunny** : hors étape.

---

## Verdict

**PORTE FERMÉE**

Le paywall `PENDING`, l'IDOR (404), le pipeline d'upload §4.5 (magic bytes, réencodage, chiffrement, UUID, URL signée liée à l'admin **et** à la session) et l'escalade tiennent sous attaque réelle. Ce qui ferme la porte, ce n'est pas un étudiant qui vole un reçu ou un chapitre : c'est §4.6 — des URLs signées et un jeton de reset dans stdout, le second ayant servi à changer le mot de passe de A.

**Décompte : CRITIQUE 0 · ÉLEVÉ 2 · MOYEN 3 · FAIBLE 5.**

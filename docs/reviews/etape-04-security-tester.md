# Étape 04 — Rapport de sécurité

**Date** : 2026-09-04
**Cible** :
- BFF Next sur `http://localhost:3000` (canal navigateur)
- API Django (dev, `DEBUG=True`) sur `http://127.0.0.1:8000` (debug local uniquement)
- Docker Compose UP (`api`, `web`, `db`, `purge`)
- Seed : cours `flutter-firebase-debutants`, leçon gratuite `id=1` (`installer-flutter-et-configurer-ton-editeur`), leçon payante `id=2` (`ton-premier-widget`). Tous les `video_provider_id` sont vides en base (aucune vidéo déposée). `BUNNY_TOKEN_AUTH_KEY` et `BUNNY_CDN_HOSTNAME` vides dans l'env live.

**Comptes utilisés** (créés pour ce pentest) :
- Étudiant A `PENDING` puis `ACTIVE` via `Enrollment.objects.filter(...).update(status='ACTIVE')` : `penta4-1788542099@test.tld` (`id=8`, téléphone `0550112241`)
- Étudiant B `PENDING` : `pentb4-1788542099@test.tld` (`id=9`)
- Étudiant P `PENDING` (reset) : `pentp4-1788542099@test.tld` (`id=10`)
- Inscription A avec `"is_staff":true,"role":"admin","status":"ACTIVE"` à l'enregistrement → compte créé `is_staff:false`

**Ce qui a pu être testé** : checklist §8 points 1–10. Point 5 exercé en **curl live** (404/paywall/IDOR/GET/503/heartbeat après insertion de `PlaybackToken`) **et** `pytest apps/media/tests/` (56 passed) pour l'émission de jetons Bunny, le rate-limit 429, la session unique, l'`AuditLog` et `bcdn_token`.

**Ce qui n'a pas pu l'être** : lecture HLS réelle (Bunny vide → pas d'`playback_url` live) ; DRM / referrer allow-list Bunny ; instance `DEBUG=0` / `next start` ; IDOR progression / QCM / certificats (routes absentes, étape 5–7) ; uploads rejoués en entier (régression SVG seulement). Détaillé en « Non testé ».

Jetons insérés en base pour le heartbeat live (puis `video_provider_id` de la leçon 2 remis à `''`) :

| alias | uuid | user | état |
|---|---|---|---|
| TOK_A | `e4c1f00c-ec6e-4fbd-a54d-ffaabe8802c1` | A | actif, `ip_prefix=203.0.113` |
| TOK_A_EXP | `d4ddba2b-7c44-4dc4-9809-595e65e20aa1` | A | `expires_at` passé |
| TOK_A_CONS | `976e7368-2fd7-48d2-90c9-9ffb8aa88325` | A | `consumed=True` |
| TOK_B | `b09016fe-b9ce-4c69-8675-61735abf5f0b` | B | actif |
| GHOST | `713f7dfe-7fac-463b-884b-ce5cea8bfad8` | — | inexistant |

---

## Synthèse

| # | Point checklist | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | IDOR | Oui (playback_id A↔B, heartbeat, chapitres, admin) | A / B / anonyme : **404** identique à un UUID fantôme, jamais 403. `?user_id=` hors surface. Progression / QCM / certificats : routes absentes | RAS |
| 2 | Fuite de contenu | Oui | Pas de `video_provider_id`, pas de `.m3u8` / `b-cdn.net` / `bcdn_token` dans l'API chapitre ni le SSR. 503 générique sans id fournisseur. Titres payants dans l'arbre public : prévu | RAS |
| 3 | Escalade de privilèges | Oui | `is_staff` / `role` / `status` / `enrollment_status` à l'inscription, au POST playback et au heartbeat : ignorés. PENDING + payload admin → toujours 404 payant | RAS |
| 4 | Contournement de paywall | Oui | PENDING / anonyme : leçon payante 404 bit-à-bit identique à `999999`. ACTIVE : 200 `disponible:false` (pas de vidéo) ou 503 si `video_provider_id` posé sans Bunny. SSR `/gratuit` payant 404, `/app/chapitre` PENDING 404 / ACTIVE 200 | RAS |
| 5 | Vidéo | Oui (curl + pytest) | Heartbeat expiré / autre /24 / autre compte / consommé → 404 identique. GET Django 404. Session unique et `bcdn_token` : pytest. Filigrane : `display:none` / `opacity:0` / `remove()` couverts ; **z-index / overlay / `scale(0)` non** | **MOYEN** |
| 6 | Auth | Oui (messages + cookies + reset en log) | Login / reset : mêmes corps compte connu/inconnu. Cookies `HttpOnly` + `SameSite=strict`. Jeton de reset et HMAC **masqués** dans stdout (`token=***`, `signature=***`) — E1/E2 de l'étape 3 **ne se reproduisent plus**. Rate-limit login non ré-épuisé (voir étape 2). **XFF gauche toujours crédible**, désormais branché sur l'IP-lock vidéo | **MOYEN** |
| 7 | Uploads | Régression courte | SVG + `<script>` nommé `.jpg` via BFF → 400 *Format non accepté…*. Suite complète non rejouée | RAS (voir étape 3) |
| 8 | Injection | Oui | `lessons/1 OR 1=1` : 404 de routage (HTML DEBUG Django, JSON 404 au BFF). Heartbeat `is_staff` ignoré. `watermark_label` en texte React. Pas de `dangerouslySetInnerHTML` sur le filigrane | RAS ; DEBUG HTML = FAIBLE |
| 9 | En-têtes & config | Oui | CSP BFF : `frame-src 'none'`, `media-src 'self' blob:` (Bunny vide). CORS sans `Access-Control-Allow-Origin` pour `https://evil.tld`. `/admin/` Django → 404. GET BFF playback/heartbeat → **405** (Django : 404) | FAIBLE |
| 10 | Journalisation | Oui | Access log : `signature=***` `bcdn_token=***`. Email console : `nouveau-mot-de-passe?token=***`. `AuditLog` PLAYBACK : pytest, pas d'URL. Réponse 503 sans hôte CDN | RAS |

---

## CRITIQUE

Aucune.

## ÉLEVÉ

Aucune.

Les deux ÉLEVÉ de l'étape 3 (URL signée de preuve dans les access logs ; jeton de reset en clair dans stdout) ont été **retestés** : le filtre `RedactSecretsFilter` + `RedactingConsoleEmailBackend` masquent `signature=`, `bcdn_token=` et `token=`. Voir point 10.

---

## MOYEN

### M1. `X-Forwarded-For` toujours pris à gauche — l'IP-lock des jetons de lecture est celui que le client déclare

- **Emplacement** : `web/lib/client-ip.ts:5-9` (`ipDuVisiteur`) recopié par le BFF playback (`web/app/api/lessons/[id]/playback/route.ts:40`) et heartbeat (`web/app/api/playback/[id]/heartbeat/route.ts:43`) ; `api/apps/accounts/utils.py:14-19` (`get_client_ip`). Inchangé depuis les étapes 2 et 3. Désormais consommé par `emettre_jeton` (HMAC Bunny lié à `client_ip`) et `battement` (`ip_prefix`).
- **Preuve** (TOK_A émis/stocké avec préfixe `203.0.113`) :

```
# même /24, dernier octet différent — le préfixe tient, heartbeat OK
POST /api/playback/e4c1f00c-…/heartbeat
Cookie: access_token=<A>
X-Forwarded-For: 203.0.113.99
→ 200 {"active":true,"resume_at_s":12}

# autre /24 — 404 identique à un UUID inexistant
X-Forwarded-For: 198.51.100.20
→ 404 {"detail":"Non trouvé."}

# même 404 via le BFF
POST http://localhost:3000/api/playback/e4c1f00c-…/heartbeat
Cookie: session=<A>
X-Forwarded-For: 198.51.100.20
→ 404 {"detail":"Non trouvé."}
```

Le BFF recopie l'en-tête client : un compte `ACTIVE` qui demande un jeton avec `X-Forwarded-For: <IP de l'ami>` obtient (une fois Bunny configuré) une URL HMAC'd pour cette IP. L'ami n'a pas besoin du heartbeat : `playback_url` suffit à HLS/ffmpeg. Le compteur `flagged_for_review` (§4.1.6) peut encore se déclencher ; **il ne coupe pas**.
- **Impact** : la liaison IP du §4.1.2 est réelle contre un jeton *volé* depuis un autre préfixe (preuve live : 404). Elle n'est pas réelle contre un titulaire de compte qui choisit l'IP à la signature. Ce n'est pas un contournement de paywall `PENDING`.
- **Règle enfreinte** : §4.1.2 (token lié à l'IP) ; §4.2 (rate-limit par IP déjà noté).
- **Remédiation** : dériver l'IP du hop de confiance (adresse socket / `X-Forwarded-For` de droite, ou en-tête posé par le reverse-proxy et non recopié depuis le navigateur).

### M2. Le détecteur de filigrane ignore `z-index`, `transform: scale(0)` et un overlay opaque

- **Emplacement** : `web/lib/filigrane.ts:23-54` (`filigraneEstVisible`) ; observateurs dans `web/components/course/LecteurSecurise.tsx:140-177`.
- **Preuve** :

Les cas exigés par §4.1.4 **tiennent** dans la fonction (tests `web/tests/filigrane.test.ts`) : `display:none`, `opacity:0`, nœud retiré → `false`. `LecteurSecurise` redemande un jeton après `remove()` (`web/tests/lecteur-securise.test.tsx` — avec un mock de visibilité qui se réduit à `contains`).

`filigraneEstVisible` ne lit ni `z-index` ni `transform`. Un `style.zIndex = '-1'` (le cadre est `relative`, le `<video>` est le premier enfant) envoie le calque derrière la vidéo ; `getComputedStyle` reste `opacity: 0.15` / `display: block`, `IntersectionObserver` ignore l'occlusion, `tickStyle` (1 s) rappelle la même fonction → **pas de pause**. `transform: scale(0)` : `offsetWidth` n'est pas affecté par un transform CSS ; un `getBoundingClientRect` dégénéré *à l'intérieur* du cadre passe encore le test d'intersection. Un `div` opaque ajouté en frère (z-index supérieur) déclenche `MutationObserver` (`childList`) puis `filigraneEstVisible` reste `true`.

Lecteur live **non exercé** : seed sans `video_provider_id` → phase `attente`, pas de nœud `[data-filigrane]` dans le SSR. Constatation sur le code du détecteur, pas sur une capture d'écran.
- **Impact** : un étudiant `ACTIVE` qui screen-record depuis le lecteur in-app peut masquer le calque sans casser la lecture. Ça ne donne pas le fichier HLS (le filigrane n'y est de toute façon pas brûlé). Ça affaiblit le contrôle anti-fuite écran du §4.1.4.
- **Règle enfreinte** : §4.1.4 (« supprimé ou masqué » → pause + nouveau jeton).
- **Remédiation** : traiter comme masqué tout nœud dont le style calculé a `z-index` sous la vidéo, un `transform` qui réduit la boîte sous le seuil, ou un recouvrement (élément au-dessus avec intersection). Ne pas mocker `filigraneEstVisible` dans le test d'intégration du lecteur.

---

## FAIBLE

### F1. GET sur les Route Handlers BFF playback / heartbeat → 405, pas 404

Django : `GET /api/lessons/1/playback` et `GET /api/playback/<uuid>/heartbeat` → `404 {"detail":"Non trouvé."}` (méthodes `get()` qui lèvent `Http404`).

BFF :

```
GET http://localhost:3000/api/lessons/1/playback  → 405 Method Not Allowed (corps vide)
GET http://localhost:3000/api/playback/<uuid>/heartbeat → 405
OPTIONS …/api/lessons/1/playback → 204  Allow: OPTIONS, POST
```

Le 405 est le même pour un id existant, inexistant ou non numérique (pas de handler GET). Il confirme la *famille* de routes, pas l'existence d'une leçon. Django `PUT` → 405 `Méthode « PUT » non autorisée.` quel que soit l'id (la vue existe). Cosmétique vis-à-vis du « GET → 404 » demandé.

### F2. `DEBUG=True` en local divulgue le URLconf

`GET http://127.0.0.1:8000/this-path-does-not-exist` et `POST /api/lessons/1%20OR%201=1/playback` → HTML Django « Page not found », `DEBUG = True`, liste `api/`, `api/public/`, `change-moi-en-chemin-imprevisible/`.
`GET /admin/` → 404. `GET /change-moi-en-chemin-imprevisible/` → 302 vers `/login/`. Attendu en dev.

### F3. Cookies d'auth sans flag `Secure` sur localhost

```
set-cookie: session=…; Path=/; Max-Age=900; HttpOnly; SameSite=strict
set-cookie: refresh=…; Path=/; Max-Age=604800; HttpOnly; SameSite=strict
set-cookie: device=…; Path=/; Max-Age=31536000; HttpOnly; SameSite=strict
```

`device` httpOnly : l'empreinte n'est pas lisible en JS. `Secure` absent (`estDev`). Cohérent avec HTTP local.

### F4. `script-src` contient `'unsafe-eval'` en développement

CSP du BFF (`web/middleware.ts`, `estDev`). `frame-src 'none'` est bien posé (lecteur HLS, pas d'iframe Bunny).

### F5. `/api/me` / login exposent `is_staff`

`{"id":8,"email":"penta4-…","is_staff":false,…}` — lecture seule. Register avec `"is_staff":true` → `is_staff:false`.

### F6. Un heartbeat depuis la même /24 d'un autre hôte reste 200

Par conception (`ip_prefix` = 3 premiers octets IPv4, `api/apps/accounts/utils.py:22-30`). Documenté ici parce que « autre IP » au sens hôte ≠ autre préfixe. Pas un écart au §4.1.2 tel qu'écrit (`ip_prefix`).

---

## Preuves de ce qui **tient** (point 5 et paywall)

### 1. `playback_id` expiré → heartbeat 404

```
# expires_at forcé dans le passé (django shell)
POST http://127.0.0.1:8000/api/playback/d4ddba2b-7c44-4dc4-9809-595e65e20aa1/heartbeat
Cookie: access_token=<A>  X-Forwarded-For: 203.0.113.41
→ 404 {"detail":"Non trouvé."}

# BFF, même jeton
POST http://localhost:3000/api/playback/d4ddba2b-…/heartbeat
→ 404 {"detail":"Non trouvé."}

# corps identique à un UUID inexistant
POST …/playback/713f7dfe-7fac-463b-884b-ce5cea8bfad8/heartbeat
→ 404 {"detail":"Non trouvé."}   # bodies_equal=True
```

pytest : `test_un_jeton_expire_est_404` PASSED.

### 2. Heartbeat autre préfixe IP (`X-Forwarded-For`) → 404

Voir M1. pytest : `test_heartbeat_depuis_une_autre_ip_est_404` PASSED.

### 3. A utilise le `playback_id` de B (et l'inverse) → 404 = UUID inexistant

```
# B → TOK_A
POST /api/playback/e4c1f00c-…/heartbeat  Cookie: <B>  XFF: 203.0.113.41
→ 404 {"detail":"Non trouvé."}

# A → TOK_B
POST /api/playback/b09016fe-…/heartbeat  Cookie: <A>  XFF: 198.51.100.20
→ 404 {"detail":"Non trouvé."}

# anonyme → TOK_A  /  A → jeton anonyme
→ 404 identique (bodies_equal vs GHOST)
```

BFF : B sur TOK_A → 404. pytest : `test_heartbeat_d_un_autre_compte_est_404` PASSED.

### 4. PENDING / anonyme + leçon payante → 404 identique ; ACTIVE → 200 ou 503

Corps 404 unique : `{"detail":"Non trouvé."}` (hex `7b2264657461696c223a224e6f6e2074726f7576c3a92e227d`).

| Appel | Anonyme | PENDING B | ACTIVE A |
|---|---|---|---|
| `POST /api/lessons/2/playback` (vidéo vide) | 404 | 404 (+ `is_staff`/`role`/`status` dans le JSON) | **200** `disponible:false`, `playback_url:null`, `watermark_label:"penta4-1788542099 · 2241"` |
| `POST /api/lessons/999999/playback` | 404 | 404 | 404 |
| `POST /api/lessons/1/playback` (gratuit, vidéo vide) | 200 `watermark_label:"visiteur"` | 200 `… · 2242` | 200 |
| `POST /api/lessons/2/playback` après `video_provider_id='pentest-vid-etape4'` (Bunny vide) | 404 | 404 | **503** `{"detail":"Vidéo indisponible."}` — pas d'id, pas de `b-cdn` |
| BFF équivalent | 404 / 200 / 503 identiques | 404 | 200 puis 503 |

`video_provider_id` de la leçon 2 a été remis à `''` après la preuve 503.

### 5. GET playback et GET heartbeat

Django : 404 JSON. BFF : 405 (F1). pytest : `test_get_sur_playback_reste_404`, `test_get_sur_heartbeat_reste_404` PASSED.

### 6. GET chapitre sans `video_provider_id`, sans `.m3u8` / `b-cdn.net`

```
GET /api/chapters/ton-premier-widget  Cookie: <A>
→ 200 {"id":2,"slug":"ton-premier-widget",…,
      "lesson":{"id":2,"duration_s":600,"transcript":"","resources":[]},…}

GET /api/public/chapters/ton-premier-widget → 404
GET /api/chapters/ton-premier-widget  Cookie: <B> → 404  # = slug fantôme
```

Aucune des clés `video_provider_id`, `bcdn_token`, `b-cdn.net`, `.m3u8` dans le JSON A, le chapitre public gratuit, ni le SSR (`/`, `/gratuit/…`, `/app/chapitre/ton-premier-widget`). pytest : `test_un_chapitre_n_expose_plus_l_identifiant_fournisseur` PASSED.

### 7. `is_staff` / `role` / `status` n'ouvre aucune porte

Register A avec le payload admin → `is_staff:false`. POST playback PENDING B avec le même payload → 404 payant. Heartbeat A avec `{"watched_s":20,"is_staff":true,"role":"admin","score":100}` → 200, `resume_at_s:20` seulement (le serializer heartbeat n'a que `watched_s`). pytest : `test_is_staff_dans_le_corps_n_ouvre_aucune_porte` PASSED.

### 8. Rate limit d'émission → 429

Live : non atteignable (pas d'émission, Bunny vide ; le plafond est *après* le check `video_provider_id` / clé Bunny). pytest avec `PLAYBACK_RATE_LIMIT_BURST = 3` :

`test_le_rate_limit_d_emission_renvoie_429` PASSED — 4e POST → `429 {"detail":"Trop de tentatives. Réessaie plus tard."}`.

`test_trop_de_jetons_par_heure_flague_sans_couper` PASSED — 3e jeton **200**, `flagged_for_review=True`, `is_active=True` (pas de coupure auto, §4.1.6).

### 9. `AuditLog` sans URL signée / `bcdn_token`

Live : aucune ligne `PLAYBACK_ISSUED` (pas d'émission réelle). pytest : `test_l_emission_est_journalisee_sans_url` PASSED — metadata = `playback_id`, `ip_prefix`, `concurrent` ; `"bcdn_token" not in metadata`, `"playback_url" not in metadata`.

Access log d'un GET piège :

```
GET /api/admin/proofs/00000000-0000-4000-8000-000000000000/file?expires=1&signature=LEAKME_HMAC_ETAPE4&bcdn_token=LEAKME_BCDN
→ django.server : …/file?expires=1&signature=***&bcdn_token=***  401
django.request : Unauthorized: /api/admin/proofs/…/file   # sans query
```

### 10. SSR `/` et `/gratuit/…` : aucune URL média ; filigrane dans `LecteurSecurise`

```
GET http://localhost:3000/          → 200, CSP frame-src 'none'
GET http://localhost:3000/gratuit/installer-flutter-et-configurer-ton-editeur → 200
GET http://localhost:3000/gratuit/ton-premier-widget → 404 Next
GET http://localhost:3000/app/chapitre/ton-premier-widget  Cookie: <B> → 404 (titre payant absent)
GET … Cookie: <A> → 200 « Ton premier widget : Hello Algérie » + « Chargement de la vidéo »
sitemap.xml → `/` et le seul chapitre `is_free`
```

Scan `video_provider_id` / `bcdn_token` / `b-cdn.net` / `.m3u8` / `mediadelivery.net` : **aucun hit**. `data-filigrane` absent du HTML SSR (phase chargement / attente, pas de jeton). Présent dans `web/components/course/LecteurSecurise.tsx:303` (`data-filigrane="1"`, `pointer-events-none`, `opacity: 0.15`, `controlsList="nodownload"`). Test unitaire : le nœud est posé dès qu'une lecture factice est hydratée.

### 11. `playback_url` contient `bcdn_token` si 200, jamais `BUNNY_TOKEN_AUTH_KEY`

Live : jamais de 200 avec URL (Bunny vide). pytest `test_un_anonyme_lit_le_chapitre_gratuit` PASSED :

- `"bcdn_token=" in playback_url`
- `VIDEO_ID` dans l'URL
- `"cle-de-test-bunny-token-auth" not in playback_url`

`test_signature_impossible_devient_503_generique` / `test_bunny_absent_renvoie_503_generique` : 503 sans `b-cdn` dans le corps.

### 12. Second `X-Device-Fingerprint` invalide le premier

Live : pas d'émission. pytest `test_un_second_appareil_invalide_le_premier` PASSED : 2e POST `empreinte=appareil-b` → nouveau `playback_id`, `concurrent_play_attempts == 1`, heartbeat de l'ancien id → 404, `consumed=True`. Rafraîchissement même empreinte : compteur inchangé.

---

## IDOR / auth / uploads / injection (compléments)

```
# A, routes admin
# (non rejoué en long ; même deny-by-default qu'étape 3 — 404 étudiant)

GET /api/progress          → 404 HTML DEBUG (étape 5)
GET /api/attempts/1        → 404 HTML DEBUG (étape 6)
GET /api/certificates      → 404 HTML DEBUG (étape 7)

# Auth
POST /api/auth/login  inconnu vs P mauvais mot de passe
→ 401 {"detail":"Email ou mot de passe incorrect."}  bodies_equal=True
POST /api/auth/password-reset/request  P vs inconnu
→ 200 même message générique  bodies_equal=True
stdout : http://localhost:3000/nouveau-mot-de-passe?token=***

# Upload régression
POST BFF /api/enrollment/proof  SVG+<script> filename=reçu.jpg type=image/jpeg
→ 400 {"detail":"Format non accepté. Envoie une image JPEG ou PNG, ou un PDF."}

# CORS
OPTIONS BFF Origin: https://evil.tld → 204, pas d'Access-Control-Allow-Origin
POST Django Origin: https://evil.tld → 200 JSON (chapitre gratuit), pas d'ACAO
```

---

## Non testé (avec raison)

- **HLS / `playback_url` live** : `BUNNY_*` vides, `video_provider_id` vides. 503 et `disponible:false` prouvés ; la forme `bcdn_token` uniquement via pytest (settings de test `vz-test.b-cdn.net`).
- **DRM Bunny, referrer allow-list, direct-play désactivé** : configuration du pull zone, hors dépôt.
- **Filigrane dans un navigateur sur une vraie lecture** : pas de manifeste. Preuves = tests unitaires + lecture du détecteur (M2).
- **Rate-limit 429 en curl live** : aucune émission (voir §8). pytest.
- **IDOR progression / tentatives QCM / certificats** : endpoints absents.
- **Uploads §4.5 complets** : non rejoués. Régression SVG 400. Voir `docs/reviews/etape-03-security-tester.md` point 7.
- **Rate-limit login 5/15 min** : non ré-épuisé (éviter de bloquer les comptes de pentest). Inchangé depuis l'étape 2.
- **Django `DEBUG=0` / Next `next start`** : non rejoué. `prod.py` force `DEBUG = False`.
- **Timing d'énumération** (égalité au ms près login/register/reset) : non mesuré cette session ; messages identiques oui.

---

## Verdict

**PORTE OUVERTE**

Le paywall `PENDING`, l'IDOR des jetons (404 = UUID inexistant), l'absence de `video_provider_id` dans toute réponse inspectée, GET Django 404, 503 générique, session unique / 429 / `flagged_for_review` sans coupure (pytest), et la journalisation des secrets (E1/E2 de l'étape 3 **clos**) tiennent sous attaque réelle. Rien en CRITIQUE ni ÉLEVÉ : un `PENDING` n'obtient pas de leçon payante, un jeton d'A ne sert pas à B, un jeton expiré ou d'une autre /24 est un 404.

Ce qui reste est de la défense en profondeur : l'IP-lock vidéo croit le `X-Forwarded-For` gauche (M1), et le détecteur de filigrane ne couvre pas tout masquage CSS (M2). Ni l'un ni l'autre n'ouvre le contenu payant sans inscription `ACTIVE`.

**Décompte : CRITIQUE 0 · ÉLEVÉ 0 · MOYEN 2 · FAIBLE 6.**

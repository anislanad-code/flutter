# Étape 05 — Rapport de sécurité

**Date** : 2026-09-04
**Branche** : `claude/etape-05-lecteur-video-71fc9n` (commit `1cdba48` — *feat: étape 5 — parcours et progression (le pipeline)*)

**Cible**
- API Django (dev, `DJANGO_SETTINGS_MODULE=config.settings.dev`, `DEBUG=True`) sur `http://127.0.0.1:8000`
- BFF Next **en build de production** (`next build` puis `next start`) sur `http://127.0.0.1:3000`
- PostgreSQL 16 local, base `anisdev`, seed `manage.py seed_course`
- Formation `flutter-firebase-debutants` : module 0 (`installer-flutter-et-configurer-ton-editeur` **is_free**, `ton-premier-widget`, `comprendre-le-hot-reload`), module 1 (`variables-et-types`, `fonctions-et-parametres`, `classes-et-objets`) — tous payants sauf le premier.

**Comptes utilisés** (créés pour ce pentest, via `POST /api/auth/register` puis `login`)

| alias | email | `User.id` | inscription |
|---|---|---|---|
| A | `a@test.dz` | 1 | `ACTIVE` (basculée en shell) |
| B | `b@test.dz` | 2 | `ACTIVE`, puis `BLOCKED` le temps d'un test, puis `ACTIVE` |
| P | `p@test.dz` | 3 | `PENDING`, jamais validée |
| T1 / T2 | `t1@test.dz` / `t2@test.dz` | 4 / 5 | `PENDING`, uniquement pour la mesure de temps de réponse |

Pas de compte admin monté pour cette étape : l'étape 5 n'introduit **aucune** route `/api/admin/*`. Le
cloisonnement admin est repoussé à l'étape 7 (voir « Non testé »).

**Ce qui a pu être testé** : la checklist §8 dans son intégralité sur la surface de l'étape 5
(`GET /api/progress`, `POST /api/chapters/{slug}/complete`, le Route Handler Next
`/api/chapters/[slug]/complete`, le SSR de `/app` et `/app/chapitre/[chapitre]`), en exploitation
réelle par `curl` contre les deux serveurs démarrés, plus les points de contact avec les étapes 3 et 4
(paywall `a_acces_au_contenu`, heartbeat de lecture, jetons Bunny).

**Ce qui n'a pas pu l'être** : lecture HLS réelle (compte Bunny absent — j'ai posé une
`BUNNY_TOKEN_AUTH_KEY` factice pour obtenir une URL signée, pas pour la jouer) ; instance Django
en `settings.prod` ; rejeu de refresh token et TTL de reset (étape 1, non rejoués) ; uploads
(étape 3, non rejoués). Détail en « Non testé ».

> **Incident d'environnement à signaler** : le mot de passe du rôle PostgreSQL `anisdev` a été
> réinitialisé par l'environnement à trois reprises pendant la session, provoquant des 500
> `OperationalError` sans rapport avec le code. Chaque salve de tests a été rejouée après
> `ALTER ROLE`. Les résultats ci-dessous sont tous issus de requêtes où la base répondait.

---

## Synthèse

| # | Point checklist | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | **IDOR** | Oui — 6 paramètres de requête, 12 champs de corps (JSON, form, multipart), 6 en-têtes d'usurpation, heartbeat croisé | Aucune surface. `request.user` est la seule source de l'identité sur les deux routes ; le corps de `complete` n'est **jamais lu**. B ne voit et n'écrit que sa propre progression | RAS |
| 2 | **Fuite de contenu** | Oui — JSON, SSR HTML, payload RSC | `GET /api/progress` ne renvoie que `id/slug/order/title/is_free/state` + agrégats. Aucun `transcript`, `video_provider_id`, `watched_s`, `completed_at`, email ou id d'un tiers | FAIBLE (F3) |
| 3 | **Escalade de privilèges** | Oui — `is_staff`, `is_superuser`, `role`, `status`, `enrollment_status`, `state`, `completed_at`, `watched_s`, `score`, `exam_passed`, `is_free`, `chapter_id`, `user`, `user_id` | Tous ignorés. `is_staff` reste `f` en base, `Enrollment.status` inchangé, `completed_at` non falsifiable | RAS |
| 4 | **Contournement de paywall** | Oui — API Django, Route Handler Next, SSR de prod, compte `PENDING` et `BLOCKED` | Chapitre payant → **404 bit-à-bit identique** à un slug inexistant (même md5, même temps de réponse). Chapitre gratuit → 200. `is_published=False` → 404 | **ÉLEVÉ (E1)** — mais par une autre porte : le paywall est global, pas par formation |
| 5 | **Vidéo** | Partiellement — heartbeat et régression `DONE`, jeton croisé A↔B, jeton inconnu | `DONE` ne redescend jamais à `IN_PROGRESS` ni ne perd `watched_s` malgré un heartbeat `watched_s=1`. Jeton de A rejoué par B → 404 identique à un UUID fantôme | Voir E1 (jeton Bunny signé obtenu sur une formation non payée) |
| 6 | **Auth** | Partiellement — flags de cookie, anonyme, méthodes | Cookies `session` / `refresh` / `device` : `HttpOnly` + `Secure` + `SameSite=strict`. Anonyme → 401 sur les deux routes, 307 vers `/connexion` sur `/app`. En-tête CVE-2025-29927 sans effet | **MOYEN (M3)** — redirection ouverte via `?suite=` |
| 7 | **Uploads** | Non — aucun upload dans l'étape 5 | — | Non testé |
| 8 | **Injection** | Oui — SQLi et traversée sur `course`, XSS stocké dans `Chapter.title` | ORM paramétré, 404 partout. Titre `<img src=x onerror=…>"><script>…` échappé dans le HTML SSR **et** dans le payload RSC (`</script`). Aucun `dangerouslySetInnerHTML` dans les composants de l'étape | **MOYEN (M2)** — 500 non géré sur `course=%00` |
| 9 | **En-têtes & config** | Oui | CSP à nonce + `strict-dynamic`, HSTS 1 an preload, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`. CORS : aucun reflet pour `https://evil.example`. `/admin/` Django → 404. `DEBUG = False` dans `settings/prod.py` | FAIBLE (F1, F4) |
| 10 | **Journalisation** | Oui | Ni jeton d'accès, ni `bcdn_token`, ni mot de passe dans `django.log`. La page de debug Django masque `HTTP_COOKIE`, `SECRET_KEY` et `DATABASES.PASSWORD` | RAS |

**Décompte : 0 CRITIQUE · 1 ÉLEVÉ · 4 MOYEN · 4 FAIBLE.**

---

## CRITIQUE

Aucune.

---

## ÉLEVÉ

### E1. Le paywall est global au compte, pas à la formation : un étudiant qui a payé la formation 1 obtient le contenu **et l'URL vidéo signée** de toute autre formation publiée

- **Emplacement** : `api/apps/enrollment/services.py:89-95` (`a_acces_au_contenu`), appelée sans
  argument de formation par les trois gardiens du paywall :
  - `api/apps/learning/views.py:71` — `POST /api/chapters/{slug}/complete` (**écrit à l'étape 5**)
  - `api/apps/catalog/views.py:96` — `GET /api/chapters/{slug}` (contenu de la leçon)
  - `api/apps/media/services.py:83` — `POST /api/lessons/{id}/playback` (jeton Bunny)

```python
# api/apps/enrollment/services.py:95
return Enrollment.objects.filter(user=user, status=Enrollment.Status.ACTIVE).exists()
```

La question posée est « ce compte a-t-il **une** inscription active ? », jamais « ce compte a-t-il une
inscription active **sur la formation qui contient ce chapitre** ? ». Or `Enrollment` porte bien un
`course` (`CLAUDE.md §5`), et `CLAUDE.md §1` fige que « la plateforme doit accueillir d'autres
formations plus tard ». Le contrôle §4.4 (« le chapitre gratuit est le seul contenu accessible sans
`Enrollment.status == ACTIVE` ») est écrit au singulier et interprété ici comme un droit global.

- **Preuve** — une seconde formation publiée est semée (`react-native-avance`, un chapitre payant
  `rn-chapitre-payant`, leçon `id=8`, `video_provider_id` posé). Le compte **A** est `ACTIVE`
  **uniquement** sur `flutter-firebase-debutants`, et n'a aucune inscription sur cette seconde
  formation :

```
$ psql -tAc "select e.user_id, c.slug, e.status from enrollment_enrollment e
             left join catalog_course c on c.id=e.course_id where e.user_id=1"
1|flutter-firebase-debutants|ACTIVE
```

1. Jeton de lecture Bunny signé, sur une formation jamais payée :

```
$ curl -s -i -X POST "http://127.0.0.1:8000/api/lessons/8/playback" \
    -H "Cookie: access_token=$TOKEN_A" -H 'Content-Type: application/json' -d '{}'
HTTP/1.1 200 OK
{"disponible":true,"playback_id":"a8d081f7-91e9-4743-9fc4-c7781042046b",
 "playback_url":"https://vz-test.b-cdn.net/bcdn_token=HS256-8xIVRMhzbqwikGf89dcQLyOrT_3EvPkEDNXzXq-8Xfo&token_path=%2F99999999-8888-7777-6666-555555555555%2F&expires=1788545855/99999999-8888-7777-6666-555555555555/playlist.m3u8",
 "expires_at":"2026-09-04T19:17:35.013635+01:00","watermark_label":"a · 5000",
 "resume_at_s":0,"duration_s":999}
```

2. Contenu textuel complet de la leçon payante :

```
$ curl -s -i "http://127.0.0.1:8000/api/chapters/rn-chapitre-payant" -H "Cookie: access_token=$TOKEN_A"
HTTP/1.1 200 OK
{"id":8,"slug":"rn-chapitre-payant","title":"Chapitre payant F2","is_free":false,
 "lesson":{"id":8,"duration_s":999,"transcript":"CONTENU PAYANT F2","resources":[]},
 "module_title":"M0","course_slug":"react-native-avance","course_title":"React Native avance"}
```

3. Et la surface introduite par l'étape 5 suit la même règle — progression écrite et pipeline lu sur
   une formation non payée :

```
$ curl -s -i -X POST "http://127.0.0.1:8000/api/chapters/rn-chapitre-payant/complete" \
    -H "Cookie: access_token=$TOKEN_A" -H 'Content-Type: application/json' -d '{}'
HTTP/1.1 200 OK
{"chapter_slug":"rn-chapitre-payant","state":"termine"}

$ curl -s "http://127.0.0.1:8000/api/progress?course=react-native-avance" -H "Cookie: access_token=$TOKEN_A"
{"course_slug":"react-native-avance","resume_chapter_slug":null,"modules":[{"id":3,"order":0,
 "title":"Module payant","unlocked":true,"completed_chapters":1,"total_chapters":1,"chapters":[
 {"id":7,"slug":"rn-chapitre-payant","order":1,"title":"Chapitre payant formation 2",
  "is_free":false,"state":"termine"}]}]}
```

Contre-preuve que le contrôle *existe* et fonctionne dans le cas nominal : le même appel depuis le
compte `PENDING` P, et l'appel sur une formation `is_published=False`, renvoient bien 404.

- **Impact** : le jour où une deuxième formation est publiée, un seul achat à 12 000 DZD ouvre
  l'intégralité du catalogue — vidéos signées comprises — à tous les étudiants déjà actifs. Le
  business « plusieurs formations » du §1 n'a pas de mur entre ses produits.
- **Règle enfreinte** : `CLAUDE.md §4.4` (le paywall est défini par `Enrollment.status == ACTIVE`,
  or `Enrollment` est par `(user, course)`) et `§4.3` (« contrôle **au niveau de l'objet** sur chaque
  endpoint qui prend un id — jamais “l'utilisateur est authentifié donc il peut lire cette
  ressource” » : ici, « l'utilisateur a payé quelque chose donc il peut lire ceci »).
- **Pourquoi ÉLEVÉ et pas CRITIQUE** : aujourd'hui une seule formation est publiée en base, donc
  l'exploitation en production nécessite d'abord la publication d'une seconde formation. C'est une
  condition de **données**, pas de code : aucune ligne ne sera ajoutée pour ouvrir la faille, il
  suffira d'un `is_published = True`. Le classement passe mécaniquement à CRITIQUE ce jour-là.
- **Remédiation (direction, pas patch)** : le paywall doit prendre la ressource en argument, pas
  seulement l'utilisateur — une signature du type `a_acces_au_chapitre(user, chapter)` qui remonte
  `chapter.module.course` et exige une inscription `ACTIVE` **sur cette formation**. Les trois
  appelants doivent passer par elle, et un test doit exister avec deux formations publiées.

---

## MOYEN

### M1. `GET /api/progress` n'a aucune limitation de débit, et re-requête la base à chaque module

- **Emplacement** : `api/apps/learning/views.py:25-41` (aucun `enforce_rate_limit`, aucun
  `throttle_classes`) ; `api/config/settings/base.py:123-128` (`REST_FRAMEWORK` ne déclare **aucun**
  `DEFAULT_THROTTLE_CLASSES`) ; `api/apps/learning/services.py:146` et `:158`.
- **Preuve** — 120 requêtes consécutives, toutes servies :

```
$ for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}" \
    "http://127.0.0.1:8000/api/progress?course=flutter-firebase-debutants" \
    -H "Cookie: access_token=$TOKEN_A"; done | tr -d '200' | wc -c
0            # aucun code différent de 200
200 count: 120 / 120
```

  Et le coût unitaire, mesuré par `CaptureQueriesContext` sur seulement **2 modules / 6 chapitres** :

```
requetes calculer_pipeline (2 modules, 6 chapitres): 5
 - SELECT "catalog_module"…
 - SELECT "catalog_chapter"…       ← prefetch du service
 - SELECT "learning_progress"…
 - SELECT "catalog_chapter"…       ← re-requête, module 1
 - SELECT "catalog_chapter"…       ← re-requête, module 2
```

  Deux défauts cumulés : (a) le `prefetch_related("modules__chapters__lesson")` de la vue
  (`views.py:34`) est intégralement gaspillé, le service repart de `course.modules.all()` avec son
  propre `prefetch_related` ; (b) `mod.chapters.all().order_by("order")` (`services.py:158`) annule
  le cache de prefetch et déclenche **une requête par module** — 3 + N requêtes, plus celles de la
  vue. Sur la formation cible complète (12 modules annoncés), ~15 requêtes par appel, sans plafond.

- **Impact** : un compte valide (ou une poignée de comptes gratuits `PENDING`, la route ne vérifie
  aucune inscription) sature la base sans jamais franchir un seuil. La route sœur
  `POST /api/chapters/{slug}/complete`, elle, est bien plafonnée à 30/60 s.
- **Règle enfreinte** : `CLAUDE.md §4.2` (esprit — plafonner ce qui touche la base) et §7 (logique
  correcte hors des vues, mais ici la vue prépare un prefetch que le service ignore).
- **Remédiation** : plafonner la lecture du pipeline comme le reste, et faire descendre le
  `prefetch` jusqu'au point de consommation au lieu de le refaire deux fois.

### M2. `?course=%00` provoque une exception non gérée (500) au lieu d'un 404

- **Emplacement** : `api/apps/learning/views.py:32-38` — le `try/except` n'attrape que
  `Course.DoesNotExist`, jamais la `ValueError` levée par le pilote avant même la requête.
- **Preuve** :

```
$ curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8000/api/progress?course=%00" \
    -H "Cookie: access_token=$TOKEN_A"
500

# extrait de la page de debug (dev) :
EXC: PostgreSQL text fields cannot contain NUL (0x00) bytes
```

  Toutes les autres valeurs malformées testées se comportent correctement (404, corps identique) :
  vide, `'`, `' OR 1=1--`, `flutter-firebase-debutants' OR '1'='1`, `../../etc/passwd` encodé,
  `flutter%`, `*`, `[]`, 5 000 caractères, paramètre absent, paramètre dupliqué. **Aucune injection
  SQL** : l'ORM paramètre, `%` et `_` ne sont pas interprétés (recherche par égalité, pas `LIKE`).

- **Impact** : en dev, une page de debug de 245 Ko partant vers le client à chaque octet nul.
  En production (`DEBUG = False` vérifié dans `config/settings/prod.py:8`), pas de trace divulguée,
  mais un 500 déclenchable à volonté par un octet — bruit d'alerte et surface d'indisponibilité.
  La page de debug elle-même est correctement expurgée : `HTTP_COOKIE => '****'`,
  `access_token => '****'`, `SECRET_KEY => '****'`, `DATABASES…'PASSWORD': '****'`, et le jeton
  d'accès `eyJ1aWQ…` est absent du HTML.
- **Règle enfreinte** : `CLAUDE.md §7` (gestion d'erreurs et cas limites), `§4.6` (aucune trace
  d'exception vers le client).
- **Remédiation** : traiter le paramètre `course` comme une entrée hostile — valider la forme du
  slug avant de toucher à la base, et faire converger toutes les entrées invalides vers le même 404.

### M3. Redirection ouverte après connexion via `?suite=`, alimentée par un nouveau point d'appel de l'étape 5

- **Emplacement** :
  - `web/components/auth/FormulaireConnexion.tsx:37-38`

```ts
const suite = parametres.get("suite");
router.push(suite && suite.startsWith("/") ? suite : "/app");
```

  - `web/app/(student)/app/chapitre/[chapitre]/page.tsx:30` — **ajouté à l'étape 5** :
    `redirect(\`/connexion?suite=/app/chapitre/${slug}\`)`, avec un `slug` qui vient du chemin
    et n'est pas encodé à la construction.

- **Preuve** : `startsWith("/")` accepte `//`, qui est une URL **relative au protocole**.
  `router.push("//evil.example")` résout en `http://evil.example/` et provoque une navigation
  hors origine. La page est bien servie avec le paramètre intact :

```
$ curl -s -o /tmp/cx.html -w "%{http_code}\n" "http://127.0.0.1:3000/connexion?suite=//evil.example"
200
$ grep -c "evil.example" /tmp/cx.html
1
```

  À décharge, le point d'appel ajouté par l'étape 5 est lui **sain** : Next encode le paramètre,
  et le préfixe fixe `/app/chapitre/` interdit de commencer par `//` :

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://127.0.0.1:3000/app/chapitre/%2F%2Fevil.example"
307 http://127.0.0.1:3000/connexion?suite=%2Fapp%2Fchapitre%2F%252F%252Fevil.example
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://127.0.0.1:3000/app/chapitre/x%22%3E%3Cscript%3E"
307 http://127.0.0.1:3000/connexion?suite=%2Fapp%2Fchapitre%2Fx%2522%253E%253Cscript%253E
```

  Le trou est donc dans le consommateur (`FormulaireConnexion`), pas dans le producteur.
  L'attaquant fabrique lui-même `https://anis.dev/connexion?suite=//son-domaine.tld`.

- **Impact** : un lien portant le vrai domaine `anis.dev` dépose la victime, **une fois
  authentifiée**, sur un site contrôlé par l'attaquant — le décor idéal pour un faux
  « ta session a expiré, retape ton mot de passe ». Pas de vol de cookie (`SameSite=Strict`,
  `HttpOnly` vérifiés), mais un levier de hameçonnage crédible sur une plateforme payante.
- **Règle enfreinte** : `CLAUDE.md §4.2` (esprit : ne pas offrir de tremplin à la prise de contrôle
  de compte) et §7 (le front ne fait jamais confiance à la forme des données — ici un paramètre
  d'URL entièrement contrôlé par l'attaquant n'est pas validé).
- **Remédiation** : n'accepter comme destination qu'un chemin d'une liste blanche de préfixes
  connus, ou reconstruire la destination côté serveur ; refuser tout ce qui commence par `//`
  ou `/\`. C'est du code de l'étape 1 — mais l'étape 5 vient d'y brancher une entrée de plus.

### M4. La progression est modifiable et supprimable depuis l'admin Django sans trace d'audit

- **Emplacement** : `api/apps/learning/admin.py:10-19`.

```python
@admin.register(Progress)
class ProgressAdmin(admin.ModelAdmin):
    readonly_fields = ["user", "chapter", "watched_s", "completed_at", "updated_at"]
```

  `state` est **absent** de `readonly_fields` : il est éditable. Et ni `ProgressAdmin` ni
  `ModuleCompletionAdmin` ne posent `has_delete_permission = False` — contrairement à ce que
  l'étape 4 a fait pour `PlaybackToken` après sa revue.

- **Preuve** : lecture de code (l'admin Django n'est pas joignable en dev sur `/admin/`, le chemin
  est imprévisible — `curl http://127.0.0.1:8000/admin/` → **404**, ce qui est le comportement
  attendu). Aucune preuve d'exploitation produite : voir « Non testé ».
- **Impact** : l'admin peut faire passer un module pour terminé, ou effacer la progression d'un
  étudiant qui conteste, sans qu'aucune ligne d'`AuditLog` ne l'enregistre. À l'étape 8, ces mêmes
  lignes conditionneront la délivrance d'un certificat.
- **Règle enfreinte** : `CLAUDE.md §4.6` — « `AuditLog` pour toute action admin […] Immuable,
  jamais supprimable depuis l'interface ».
- **Remédiation** : décider explicitement ce que l'admin a le droit de toucher sur `Progress` et
  `ModuleCompletion`, verrouiller le reste en lecture seule, et journaliser ce qui reste mutable —
  comme l'étape 3 le fait déjà pour la validation de paiement.

---

## FAIBLE

### F1. `OPTIONS` publie la docstring et la forme exacte des routes

```
$ curl -s -X OPTIONS "http://127.0.0.1:8000/api/chapters/ton-premier-widget/complete" -H "Cookie: access_token=$TOKEN_A"
{"name":"Chapter Complete","description":"POST /api/chapters/{slug}/complete — marque le chapitre terminé pour l'appelant.","renders":["application/json"],"parses":["application/json","application/x-www-form-urlencoded","multipart/form-data"]}
```

Authentification requise (`OPTIONS` anonyme → 401), donc pas de fuite vers l'extérieur, et rien de
secret ici. Noté pour mémoire : la métadonnée DRF publiera un jour un commentaire moins anodin.

### F2. Le plafond de `complete` est par compte, jamais par IP

- **Emplacement** : `api/apps/learning/views.py:53-55` — `enforce_rate_limit("chapters:complete", str(request.user.pk), max_attempts=30, window_seconds=60)`.
- **Preuve** — le plafond est **réel et exact** (30 puis 429), et bien cloisonné par compte :

```
$ for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code} " -X POST \
   "http://127.0.0.1:8000/api/chapters/fonctions-et-parametres/complete" \
   -H "Cookie: access_token=$TOKEN_B" -H 'Content-Type: application/json' -d '{}'; done
200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 429 429 429 429 429

$ curl -s -X POST ".../complete" -H "Cookie: access_token=$TOKEN_B" …
{"detail":"Trop de tentatives. Réessaie plus tard."}

# le compte A n'est pas affecté :
$ curl -s -o /dev/null -w "%{http_code}\n" -X POST ".../ton-premier-widget/complete" -H "Cookie: access_token=$TOKEN_A"
200
```

Une seule IP disposant de N comptes gratuits obtient 30×N écritures/minute. §4.2 n'impose la double
clé (compte **et** IP) que sur les endpoints d'authentification, et l'écriture ici est bornée à
`(user, chapter)` — l'intérêt d'un abus est faible. Retenu comme durcissement, pas comme faille.

### F3. Le pipeline ignore le paywall : un compte `PENDING` reçoit `state:"disponible"` sur des chapitres payants

- **Emplacement** : `api/apps/learning/services.py:130-135` — `_etat_chapitre` ne connaît que la
  progression et le déverrouillage de module, jamais l'inscription.
- **Preuve** — compte P, jamais validé :

```
$ curl -s "http://127.0.0.1:8000/api/progress?course=flutter-firebase-debutants" -H "Cookie: access_token=$TOKEN_P"
{"course_slug":"flutter-firebase-debutants","resume_chapter_slug":"installer-flutter-et-configurer-ton-editeur",
 "modules":[{"id":1,…,"chapters":[
  {"id":1,"slug":"installer-…","is_free":true,"state":"disponible"},
  {"id":2,"slug":"ton-premier-widget","is_free":false,"state":"disponible"},   ← payant, compte non payé
  {"id":3,"slug":"comprendre-le-hot-reload","is_free":false,"state":"disponible"}]}, …]}
```

Aucune fuite de contenu : la réponse ne porte que des titres et des ordres, déjà publics par
`GET /api/public/course/{slug}` depuis l'étape 2. Et le front ne l'affiche pas — `web/app/(student)/app/page.tsx:42-45`
n'appelle `recupererPipeline` que si `statut === "ACTIVE"`, sinon `ParcoursEtudiant` grise les
chapitres payants. Vérifié sur le SSR de production :

```
$ curl -s "http://127.0.0.1:3000/app" -H "Cookie: session=$SESSION_P" | grep -c "Ouvre la formation complète"
1
$ curl -s "http://127.0.0.1:3000/app" -H "Cookie: session=$SESSION_P" | grep -c "Reprendre"
0
```

La protection tient donc **par un `if` dans une page**, pas par le contrat de l'API. Le jour où un
autre écran consomme `GET /api/progress` sans rejouer ce test, chaque nœud payant redevient un lien
« disponible » pour un compte non payé (qui tombera sur un 404, mais après avoir été invité à cliquer).

### F4. Django en dev renvoie la page de traceback au client

Attendu en `settings.dev`, `DEBUG = False` confirmé dans `api/config/settings/prod.py:8`. Rappelé
seulement parce que M2 rend la page atteignable par une requête d'une seule ligne.

---

## Ce qui a résisté (preuves des contrôles qui tiennent)

Ces résultats sont la contrepartie des constatations ci-dessus : ce sont les tests qui n'ont **rien**
donné, et qui répondent directement aux deux critères « Terminé quand » de l'étape.

**Critère « l'étudiant A ne peut pas lire ni modifier la progression de B ».**
Aucune surface trouvée. `ProgressView` et `ChapterCompleteView` ne prennent pas d'identifiant
d'utilisateur, et `ChapterCompleteView` **ne lit jamais `request.data`** — ce qui se prouve par le
fait qu'un corps JSON syntaxiquement invalide passe quand même :

```
$ curl -s -w " %{http_code}\n" -X POST ".../classes-et-objets/complete" \
    -H "Cookie: access_token=$TOKEN_B" -H 'Content-Type: application/json' -d '{bad json'
{"chapter_slug":"classes-et-objets","state":"termine"} 200
```

Lecture — B tente d'obtenir l'état de A par le paramètre de requête (`user`, `user_id`, `student`,
`as_user`, `user__id`, `email`, `course` dupliqué) et par en-tête (`X-User-Id`, `X-User`,
`X-Forwarded-User`, `X-Original-User`, `Remote-User`, `X-Django-User`). Les 13 réponses sont
identiques à sa propre progression, jamais celle de A :

```
A own : ['termine','termine','termine','disponible','disponible','disponible']
B own : ['disponible','disponible','disponible','recommande_plus_tard', …]
B avec user=1        : ['disponible','disponible','disponible','recommande_plus_tard', …]
B avec X-User-Id: 1  : (identique à B own)
```

Écriture — B poste sur `complete` une charge d'usurpation et de mass-assignment complète :

```
$ curl -s -X POST ".../variables-et-types/complete" -H "Cookie: access_token=$TOKEN_B" \
  -H 'Content-Type: application/json' -d '{"user":1,"user_id":1,"student":1,"owner":1,
  "email":"a@test.dz","state":"NOT_STARTED","completed_at":"1999-01-01T00:00:00Z",
  "watched_s":99999,"is_staff":true,"is_superuser":true,"role":"admin","status":"ACTIVE",
  "enrollment_status":"ACTIVE","score":100,"exam_passed":true,"is_free":true,
  "chapter":1,"chapter_id":1}'
{"chapter_slug":"variables-et-types","state":"termine"}

$ psql -tAc "select p.user_id,u.email,p.chapter_id,p.state,p.watched_s from learning_progress p
             join accounts_user u on u.id=p.user_id order by 1,3"
1|a@test.dz|1|DONE|480
1|a@test.dz|2|DONE|600
1|a@test.dz|3|DONE|420
2|b@test.dz|4|DONE|540      ← écrit sur B (id 2), pas sur A ; watched_s = durée réelle, pas 99999
$ psql -tAc "select email,is_staff,is_superuser from accounts_user"
p@test.dz|f|f
a@test.dz|f|f
b@test.dz|f|f
$ psql -tAc "select user_id,status from enrollment_enrollment"
3|PENDING
1|ACTIVE
2|ACTIVE
```

Rejoué en `application/x-www-form-urlencoded` (`user=1&user_id=1&is_staff=true&state=NOT_STARTED`),
en `multipart/form-data` (`-F user=1 -F is_staff=true`) et avec un corps de 2 Mo : même résultat,
`is_staff` reste `f`, la progression reste celle de l'appelant.

**Critère « aucun endpoint ne renvoie 403 pour un chapitre non terminé sur un compte ACTIVE ».**
Progression de A entièrement effacée, puis complétion des six chapitres **dans le désordre du
gating** (module 1 avant la fin du module 0) :

```
installer-flutter-et-configurer-ton-editeur   complete:200
ton-premier-widget                            complete:200
comprendre-le-hot-reload                      complete:200
variables-et-types                            complete:200      ← module « recommandé plus tard »
fonctions-et-parametres                       complete:200
classes-et-objets                             complete:200
```

Zéro 403 sur toute la session, sur les deux routes, dans tous les états d'inscription. Le soft
gating du §2 est respecté : `unlocked:false` ne pilote que l'affichage (`opacity-45` +
`title="Termine d'abord le module …"` dans `web/components/student/Pipeline.tsx:79-98`), le lien
reste un `<Link>` ordinaire, sans cadenas ni `aria-disabled`.

**Paywall — 404, jamais 403, et aucun oracle d'existence.**

```
$ curl -s -i -X POST ".../ton-premier-widget/complete"   -H "Cookie: access_token=$TOKEN_P"   # payant
HTTP/1.1 404 Not Found
{"detail":"Non trouvé."}
$ curl -s -i -X POST ".../chapitre-qui-nexiste-pas/complete" -H "Cookie: access_token=$TOKEN_P"
HTTP/1.1 404 Not Found
{"detail":"Non trouvé."}
$ curl -s -X POST ".../ton-premier-widget/complete"   -H "Cookie: access_token=$TOKEN_P" | md5sum
cb45182a27b66122aa46dd1ca51f6eb6  -
$ curl -s -X POST ".../zzz-inexistant-zzz/complete"   -H "Cookie: access_token=$TOKEN_P" | md5sum
cb45182a27b66122aa46dd1ca51f6eb6  -
```

Corps identiques au bit près. Temps de réponse mesurés sur deux comptes distincts (pour ne pas
confondre avec le plafond de débit), 25 tirages chacun :

```
ton-premier-widget  n=25 median=26.17 ms mean=26.78
zzz-inexistant-zzz  n=25 median=25.52 ms mean=26.95
```

Écart dans le bruit, moyennes croisées : pas d'oracle temporel exploitable.
Le chapitre gratuit reste ouvert au compte `PENDING` (200), comme le §1 l'exige. Un compte
`BLOCKED` se comporte comme `PENDING` : 404 sur le payant, 200 sur le gratuit, 200 en lecture du
pipeline. Une formation `is_published=False` renvoie 404 sur les deux routes.

Même résultat de bout en bout par le canal navigateur (Next en build de production) :

```
$ curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/app/chapitre/comprendre-le-hot-reload" -H "Cookie: session=$SESSION_P"
404
$ curl -s -w " %{http_code}\n" -X POST "http://127.0.0.1:3000/api/chapters/comprendre-le-hot-reload/complete" -H "Cookie: session=$SESSION_P"
{"detail":"Non trouvé."} 404
$ curl -s -w " %{http_code}\n" -X POST "http://127.0.0.1:3000/api/chapters/installer-flutter-et-configurer-ton-editeur/complete" -H "Cookie: session=$SESSION_P"
{"chapter_slug":"installer-flutter-et-configurer-ton-editeur","state":"termine"} 200
$ curl -s -w " %{http_code}\n" -X POST "http://127.0.0.1:3000/api/chapters/installer-…/complete"     # anonyme
{"detail":"Session invalide ou expirée."} 401
```

Le Route Handler écrase tout code non-200 en `{"detail":"Non trouvé."}` 404 (429 et 401 exceptés)
et valide la réponse par Zod avant de la relayer (`web/app/api/chapters/[slug]/complete/route.ts:47-59`) :
aucun corps d'erreur Django ne traverse. `GET` sur ce Route Handler → 404 (ligne 62).

**Régression d'état et idempotence.**
Trois `complete` d'affilée sur un chapitre déjà `DONE` : `completed_at` ne bouge pas.

```
avant : 2026-09-04 18:00:16.212577+00
200 200 200
après : 2026-09-04 18:00:16.212577+00|600
```

Le heartbeat vidéo de l'étape 4 ne fait pas redescendre un chapitre terminé — `services.py:54-57`
vérifié en live avec un jeton réel :

```
$ curl -s -X POST "http://127.0.0.1:8000/api/playback/f3398e0b-…/heartbeat" \
    -H "Cookie: access_token=$TOKEN_A" -H 'Content-Type: application/json' -d '{"watched_s":1}'
{"active":true,"expires_at":"…","resume_at_s":480}
$ psql -tAc "select user_id,chapter_id,state,watched_s from learning_progress where user_id=1"
1|1|DONE|480      ← ni l'état ni la position n'ont reculé
```

Le jeton de A rejoué par B, et un UUID inconnu, renvoient la **même** 404 :

```
B avec le playback_id de A  → {"detail":"Non trouvé."} 404
00000000-0000-0000-0000-…   → {"detail":"Non trouvé."} 404
```

**Course entre 20 requêtes concurrentes** sur un chapitre vierge : 20 × 200, **une seule** ligne
`Progress`, aucun `IntegrityError` dans le journal (la contrainte
`progress_unique_user_chapitre` tient, `select_for_update` + `get_or_create` absorbent la course).

**XSS stocké.** `Chapter.title` forcé à
`<img src=x onerror=alert(1)>"><script>alert(document.cookie)</script>`. L'API le renvoie tel quel
(correct : c'est du JSON), le SSR de production l'échappe intégralement, et le payload RSC aussi :

```
$ grep -c "<script>alert(document.cookie)</script>" app_a.html
0
$ grep -o "&lt;img src=x onerror=alert(1)&gt;[^<]*" app_a.html | head -1
&lt;img src=x onerror=alert(1)&gt;&quot;&gt;&lt;script&gt;alert(document.cookie)&lt;/script&gt;
$ grep -c "u003c/script" app_a.html
1
```

Aucun `dangerouslySetInnerHTML` dans `Pipeline.tsx`, `NoeudPipeline.tsx`, `ParcoursEtudiant.tsx`,
`BoutonTerminerChapitre.tsx`. Le paramètre `?termine=` ne sert qu'à une comparaison d'égalité
(`Pipeline.tsx:88`), jamais à un rendu.

**Méthodes HTTP.** `GET`/`PUT`/`PATCH`/`DELETE`/`HEAD` sur `complete` → 405 ;
`POST`/`PUT`/`DELETE` sur `progress` → 405. Anonyme → 401 sur les deux, 307 vers `/connexion` sur `/app`.

**En-têtes et configuration.**

```
$ curl -s -D - -o /dev/null "http://127.0.0.1:3000/app" -H "Cookie: session=$SESSION_A"
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
content-security-policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
  connect-src 'self' https://vz-test.b-cdn.net; media-src 'self' blob: https://vz-test.b-cdn.net;
  frame-ancestors 'none'; frame-src 'none'; form-action 'self'; base-uri 'self';
  object-src 'none'; upgrade-insecure-requests
```

Pas de `unsafe-inline` sur `script-src` (celui de `style-src` reste le report assumé de l'étape 0).
CORS Django : `Origin: https://evil.example` → **aucun** `Access-Control-Allow-Origin` en réponse ;
`Origin: http://localhost:3000` → origine unique, jamais `*`.
`x-middleware-subrequest: middleware:…` sur `/app` anonyme → toujours 307 vers `/connexion`
(CVE-2025-29927 close). `/admin/` Django → 404.
Cookies posés par le BFF : `session`, `refresh`, `device`, tous `HttpOnly; Secure; SameSite=strict`.

**Journalisation.** `grep` sur le journal Django complet de la session :
`bcdn_token` → 0, `access_token=eyJ` → 0, mot de passe en clair → 0.

---

## Non testé (avec raison)

- **§8.7 Uploads** — l'étape 5 n'introduit aucun téléversement. Suite de l'étape 3 non rejouée.
- **§8.6 Auth, moitié profonde** — rejeu de refresh token et chute de la famille, TTL et usage
  unique du jeton de reset, révocation des sessions au changement de mot de passe, énumération sur
  les trois endpoints, plafond 5/15 min/compte et 20/15 min/IP : **couverts à l'étape 1**, non
  rejoués ici faute de surface nouvelle. Seuls les flags de cookie et la réponse anonyme ont été
  revérifiés.
- **§8.5 Vidéo, moitié Bunny** — pas de compte Bunny. J'ai posé un `BUNNY_TOKEN_AUTH_KEY` factice
  pour obtenir une URL signée (preuve E1), mais je n'ai pu vérifier ni la referrer allow-list, ni
  la désactivation du direct-play, ni le rejeu réel d'un `bcdn_token` expiré côté CDN.
- **Filigrane** (`display:none`, `opacity:0`, `remove()`, overlay opaque) — comportement de
  navigateur, non reproductible en `curl` ; couvert à l'étape 4, inchangé par l'étape 5.
- **M4 en exploitation** — aucun compte `is_staff` monté et aucune interface admin ouverte : la
  constatation repose sur la lecture de `apps/learning/admin.py`, pas sur une manipulation réelle.
- **Cloisonnement `/api/admin/*`** — aucune route admin dans l'étape 5 (étape 7).
- **Instance en `settings.prod`** — Django tourné en `settings.dev` uniquement.
  `DEBUG = False` constaté par lecture de `config/settings/prod.py:8`, pas par exécution.
- **Plafonnement multi-worker** — la limitation de débit s'appuie sur le cache mémoire local
  (report explicite de l'étape 1). Vérifiée exacte en mono-processus, non vérifiée derrière
  plusieurs workers.
- **Accessibilité clavier et `prefers-reduced-motion`** — critères « Terminé quand » de l'étape,
  mais hors du mandat sécurité ; ils relèvent de `code-tester` / `code-reviewer`.

---

## Verdict

**PORTE FERMÉE.**

Le cœur de l'étape 5 est propre : les deux endpoints du pipeline ne prennent aucun identifiant
d'utilisateur, ne lisent pas le corps de la requête, ne renvoient jamais 403, et j'ai échoué à faire
lire ou écrire à B la moindre ligne de la progression de A par les 13 vecteurs essayés. Le paywall
et l'anti-oracle 404 tiennent sur les deux canaux, en build de production.

Ce qui bloque n'est pas l'IDOR ni l'escalade de privilèges — c'est **E1** : le paywall demande
« as-tu payé ? », pas « as-tu payé *ceci* ? ». Une inscription active sur une formation ouvre le
transcript et l'URL Bunny signée de toutes les autres. La condition d'exploitation en production
est aujourd'hui un simple `is_published = True` sur une seconde formation — c'est-à-dire la
prochaine chose que ce projet fera après la promo 1, et §1 le dit noir sur blanc.

**Décompte : 0 CRITIQUE · 1 ÉLEVÉ · 4 MOYEN · 4 FAIBLE.**

# Étape 06 — Rapport de sécurité

**Date** : 2026-09-04
**Branche** : `claude/etape-06-qcm-examens` (commit `2b8bc4f` — *feat: étape 6 — QCM de chapitre et examens de module*)

**Cible**
- API Django (`DJANGO_SETTINGS_MODULE=config.settings.dev`) sur `http://127.0.0.1:8000`, lancée par `manage.py runserver`.
  **`settings.DEBUG = False`** : l'environnement de test force `DJANGO_DEBUG=0`, vérifié après coup
  (`python -c "...print(settings.DEBUG)"` → `False`). Les réponses d'erreur observées sont donc celles
  du mode production, ce qui rend la vérification « pas de trace d'exception renvoyée au client » (§9)
  directement pertinente — voir la preuve 7.
- PostgreSQL local, base `anisdev`.
- Surface neuve de l'étape : `GET /api/quizzes/{id}` (`QuizDetailView`), `POST /api/quizzes/{id}/attempts` (`QuizStartAttemptView`), `POST /api/attempts/{id}/submit` (`AttemptSubmitView`) ; logique dans `apps/assessment/services.py` ; BFF Next `web/app/api/quizzes/[id]/attempts/route.ts` et `web/app/api/attempts/[id]/submit/route.ts` ; page `web/app/(student)/app/qcm/[id]/page.tsx` ; composant client `web/components/assessment/Qcm.tsx`.

**Seed de test** (via `manage.py shell`)

| Objet | id | Détail |
|---|---|---|
| Quiz 1 | 1 | QCM du chapitre **gratuit** (`is_free=True`), `max_attempts=2`, `min_duration_s=5` |
| Quiz 2 | 2 | QCM d'un chapitre **payant** |
| Quiz 3 | 3 | **Examen** du module 1 (payant) |
| Questions | 1,2 (quiz1) · 3,4 (quiz2) · 5,6 (quiz3) | 2 choix chacune, bonne réponse = choix d'ordre 1 |

Les textes de choix et d'explication ont été semés avec des charges XSS (`<script>alert('xss-choix')</script>`, `<img src=x onerror=alert('xss-explication-0')>`) pour tester le rendu.

**Comptes utilisés**

| alias | email | `User.id` | inscription |
|---|---|---|---|
| A | `a@example.com` | 1 | `ACTIVE` |
| B | `b@example.com` | 2 | `ACTIVE` |
| P (PENDING) | `pending@example.com` | 3 | `PENDING`, jamais validée |
| admin | `admin@example.com` | 4 | superuser (non utilisé — l'étape 6 n'introduit aucune route `/api/admin/*`) |

**Ce qui a pu être testé** : toute la checklist §8 pertinente pour l'étape, en exploitation `curl` réelle contre le serveur Django (IDOR, fuite de contenu, escalade/mass-assignment, paywall, anti-triche, injection d'answers, rate limit, en-têtes, journalisation) + relecture du composant `Qcm.tsx` pour le rendu XSS.

**Ce qui n'a pas pu l'être** : instance en `settings.prod` (CSP/HSTS/CORS posés côté Next et prod, non rejoués ici — hors surface neuve) ; BFF Next non démarré (les Route Handlers ne font que relayer et ré-appliquer un schéma Zod, testés par lecture) ; refresh-token/reset (étape 1). Détail en « Non testé ».

> **Incident d'environnement** : le rôle PostgreSQL `anisdev` accepte le mot de passe `change-moi-en-local` ; une variable d'environnement ambiante trompeuse (`POSTGRES_PASSWORD=anisdev`) a provoqué des salves de 500 `OperationalError` sans rapport avec le code de l'étape. Tous les résultats ci-dessous sont issus d'un serveur où la base répondait (relancé proprement).

---

## Synthèse

| # | Point checklist | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | **IDOR** | Oui — A soumet la tentative de B, id inexistant | `soumettre_tentative` filtre par `(pk, user)` → **404** dans les deux cas, indiscernables. La tentative de B reste intacte (`attempts_used=0`) | RAS |
| 2 | **Fuite de contenu** | Oui — `GET /api/quizzes/{id}` avant toute soumission | Ni `is_correct`, ni `explanation`, ni `order` de choix ne sortent : `ChoixPublic` = `{id, text}` seulement. Le paywall renvoie 404, pas 403 | RAS |
| 3 | **Escalade de privilèges** | Oui — `score`, `passed`, `is_correct`, `is_staff`, `is_superuser` dans le corps de submit | Tous ignorés. Score **recalculé côté serveur** (mauvaises réponses → `score=0/passed=false` malgré `score:100`). `is_staff` reste `false` en base | RAS |
| 4 | **Contournement de paywall** | Oui — PENDING sur quiz payant + examen, GET et POST, id deviné | Chapitre payant (quiz 2) et examen (quiz 3) → **404** pour PENDING sur GET *et* POST. QCM du chapitre gratuit → 200/201 (exception `is_free` attendue) | RAS |
| 5 | **Anti-triche** | Oui — submit trop rapide, plafond de tentatives, rejeu, cross-quiz | Submit < `min_duration_s` → 400. 3ᵉ tentative sur `max_attempts=2` → 409. Rejeu d'une tentative soumise → 409. Choix/question d'un autre quiz → 400 | RAS |
| 6 | **Injection** | Oui — XSS stocké dans `Choice.text`/`Question.explanation`, SQLi, bornes | Rendu React par interpolation JSX (`{choix.text}`, `{question.explanation}`) → auto-échappé, **aucun `dangerouslySetInnerHTML`** dans le chemin QCM. Aucun paramètre de filtre/tri (ORM, id `<int>`) | FAIBLE (F1) |
| 7 | **En-têtes / config** | Oui — deny-by-default, méthodes, id non entier, corps des 500 (serveur en `DEBUG=False`) | Les 3 vues sont `IsAuthenticated` : anonyme → 401. `GET` sur endpoint POST-only → 405. `id` non entier → 404 (résolveur). `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` posés. Un 500 réel ne renvoie **aucune** trace au client | FAIBLE (F2) |
| 8 | **Journalisation** | Oui — inspection de `django.server`/`django.request` | Aucun cookie, token, mot de passe ni contenu d'`answers` dans les logs : uniquement méthode/chemin/statut | RAS |

**Décompte : 0 CRITIQUE · 0 ÉLEVÉ · 1 MOYEN · 2 FAIBLE.**

---

## CRITIQUE

Aucune.

## ÉLEVÉ

Aucune.

## MOYEN

### M1. Rate-limiting mono-processus et par-compte uniquement (défense en profondeur)
- **Emplacement** : `api/apps/accounts/throttling.py` (cache local d'un seul process) ; `api/apps/assessment/views.py:61,84,118` (clé = `str(request.user.pk)` seule, pas d'axe IP).
- **Preuve** : le plafond fonctionne bien par compte — 33 POST successifs de A sur `/api/attempts/99999/submit` :
  ```
  codes: 404 ×24 429 ×9   (seuil attempts:submit = 30/60 s)
  ```
  Mais (a) la clé n'inclut aucun préfixe IP, donc un même compte reste la seule dimension limitée ; (b) le backend de cache par défaut est la mémoire d'un process — avec plusieurs workers Gunicorn le seuil réel devient `seuil × workers`.
- **Impact** : sur ces endpoints authentifiés, l'axe pertinent est le compte (déjà couvert), donc l'exposition est faible ; le point reste un durcissement manquant pour l'après-mise-en-prod.
- **Règle enfreinte** : CLAUDE.md §4.2 (rate limit « par compte **et** par IP », « réellement effectif »).
- **Remédiation** : brancher un cache partagé (Redis, déjà prévu §étape 9/10) — la limite est explicitement documentée dans `throttling.py` et différée à l'étape 10.

## FAIBLE

### F1. Réponse JSON portant la charge XSS brute (non exploitable en l'état)
- **Emplacement** : réponse de `POST /api/attempts/{id}/submit`.
- **Preuve** : le corps JSON contient bien `"text":"<script>alert('xss-choix')</script> Bonne reponse"` et `"explanation":"<img src=x onerror=alert('xss-explication-0')> ..."`. C'est attendu (JSON, pas HTML). Le rendu passe par `Qcm.tsx` en interpolation JSX (`{question.text}`, `{choix.text}`, `{question.explanation}`, `{choixCorrect?.text}`) → React échappe. `grep dangerouslySetInnerHTML` ne remonte que des artefacts `.next/` et la landing marketing, jamais le chemin QCM. `lib/markdown-leger` n'est utilisé que par `LecteurChapitre`, pas par le QCM.
- **Impact** : aucun tant que le rendu reste du JSX ; risque uniquement si un futur composant réintroduit `dangerouslySetInnerHTML` sur ces champs.
- **Remédiation** : conserver l'interdit de `dangerouslySetInnerHTML` sur tout champ de contenu QCM ; envisager un assainissement à la source (admin) des champs libres.

### F2. Ordre des choix déterministe — la bonne réponse peut trahir sa position
- **Emplacement** : `apps/assessment/services.py:97-105` (`etat_quiz`) et le modèle `Choice.Meta.ordering = ["order"]`.
- **Preuve** : `GET /api/quizzes/1` renvoie toujours les choix dans l'ordre `order`. Le champ `order` n'est pas exposé (bien), mais la position est stable entre lectures ; si l'auteur place systématiquement la bonne réponse en premier, un étudiant peut le déduire statistiquement. Aucun `is_correct` ne fuit — c'est un durcissement, pas une fuite.
- **Impact** : très faible, dépend des habitudes de saisie de l'admin.
- **Remédiation** : mélanger l'ordre des choix côté serveur (graine par `(attempt_id, question_id)`), ou imposer un ordre aléatoire à la création.

---

## Détail des preuves

### 1. IDOR — A ne peut pas soumettre/lire la tentative de B
```
# B ouvre une tentative sur le quiz gratuit → attempt id=1
POST /api/quizzes/1/attempts  (cookie=B)  → 201 {"id":1,...}

# A tente de soumettre la tentative de B
POST /api/attempts/1/submit   (cookie=A)  → 404 {"detail":"Non trouvé."}
# A soumet un id inexistant
POST /api/attempts/99999/submit (cookie=A) → 404 {"detail":"Non trouvé."}

# la tentative de B est intacte
GET /api/quizzes/1 (cookie=B) → attempts_used=0
```
`services.soumettre_tentative` filtre `Attempt.objects.filter(pk=attempt_id, user=user)` : « n'existe pas » et « appartient à autrui » renvoient la même 404 (§4.3).

### 2. Fuite de contenu — rien avant soumission
```
GET /api/quizzes/1 (cookie=A) → 200
{"id":1,"kind":"chapitre",...,"questions":[
  {"id":1,"order":1,"text":"GRATUIT question 1 ?",
   "choices":[{"id":1,"text":"<script>...</script> Bonne reponse"},
              {"id":2,"text":"Mauvaise reponse"}]}, ... ]}
```
Aucun `is_correct`, aucun `explanation`, aucun `order` de choix. `EtatQuizSerializer`/`ChoixPublicSerializer` n'ont pas ces champs.

### 3. Escalade / mass-assignment — score recalculé serveur
```
# tentative de A ouverte depuis > min_duration_s ; mauvaises réponses (choix 2 et 4)
POST /api/attempts/3/submit (cookie=A)
  body: {"answers":{"1":2,"2":4},"score":100,"passed":true,"is_staff":true,"is_superuser":true}
→ 200 {"attempt_id":3,"score":0,"passed":false,...}
GET /api/me (cookie=A) → is_staff=False
```
`SubmitRequestSerializer` n'accepte que `answers` ; le score vient de `Choice.is_correct` en base.

### 4. Paywall — PENDING bloqué partout, 404 (pas 403)
```
GET  /api/quizzes/2 (cookie=P) → 404   (chapitre payant)
GET  /api/quizzes/3 (cookie=P) → 404   (examen payant)
POST /api/quizzes/2/attempts (cookie=P) → 404
POST /api/quizzes/3/attempts (cookie=P) → 404
# exception is_free honorée :
GET  /api/quizzes/1 (cookie=P) → 200
POST /api/quizzes/1/attempts (cookie=P) → 201
```
`a_acces_au_quiz` : QCM de chapitre = `chapter.is_free or a_acces_au_contenu` ; examen = toujours `a_acces_au_contenu` (un module n'est jamais gratuit).

### 5. Anti-triche
```
# trop rapide (min_duration_s=5) :
POST /api/attempts/2/submit (cookie=A) → 400 "Réponds un peu plus lentement…"
# plafond (max_attempts=2, 2 soumises) :
POST /api/quizzes/1/attempts (cookie=A) → 409 "Tu as utilisé toutes tes tentatives…"
# rejeu d'une tentative déjà soumise :
POST /api/attempts/3/submit (cookie=A) → 409 "Cette tentative a déjà été corrigée."
# answers cross-quiz (choix 1 dans une question du quiz 3) :
POST /api/attempts/6/submit body {"answers":{"5":1,"6":11}} → 400 "Réponses invalides pour ce QCM."
# question étrangère au quiz :
POST /api/attempts/6/submit body {"answers":{"1":9}} → 400
# bornes serializer :
{"answers":{"0":9}}  → 400 "Identifiant de question invalide."
{"answers":{"5":-1}} → 400 "…supérieure ou égale à 1."
{"answers":{"5":"abc"}} → 400 "Un nombre entier valide est requis."
```

### 6. Injection / XSS — cf. F1 (rendu JSX auto-échappé, aucun `dangerouslySetInnerHTML` dans le chemin QCM). Pas de paramètre de filtre/tri ; `id` typé `<int:id>`.

### 7. Deny-by-default / méthodes / config
```
GET  /api/quizzes/1                (sans cookie) → 401
POST /api/attempts/1/submit        (sans cookie) → 401
GET  /api/attempts/6/submit        (cookie=A)    → 405 "Méthode « GET » non autorisée."
GET  /api/quizzes/abc              (cookie=A)    → 404
GET  /api/quizzes/1  en-têtes → X-Frame-Options: DENY ; X-Content-Type-Options: nosniff
settings/prod.py → DEBUG=False, HSTS 1 an preload, cookies Secure, admin hors /admin/
```
**Trace d'exception (§9)** — pendant l'incident de mot de passe PostgreSQL, des 500 réels ont été
provoqués sur `POST /api/attempts/{id}/submit`. Avec `DEBUG=False`, le corps renvoyé au client est
intégralement muet :
```
HTTP 500
<!doctype html><html lang="en"><head><title>Server Error (500)</title></head>
<body><h1>Server Error (500)</h1><p></p></body></html>
```
Aucun nom de fichier, aucune ligne de code, aucun identifiant de base, aucune variable
d'environnement. La trace complète (`OperationalError`, hôte et rôle PostgreSQL) reste côté
serveur, dans `srv.log`. À titre de contraste, une instance lancée en `DEBUG=True` en début de
session renvoyait bien la page de debug Django complète — comportement normal de Django en
développement, neutralisé en production par `settings/prod.py` (`DEBUG = False`, non surchargeable
par l'environnement).

### 8. Journalisation
`django.server`/`django.request` : uniquement `"POST /api/attempts/... HTTP/1.1" <code>`. Aucun `access_token`, `password`, `refresh_token`, `Cookie:` ni contenu d'`answers` dans `srv.log`.

---

## Non testé (avec raison)
- **CSP / HSTS / CORS effectifs côté prod** : instance `settings.prod` et middleware Next non démarrés dans cette session ; posés et vérifiés aux étapes 4–5, non rejoués faute de surface neuve à l'étape 6. Django pose bien `X-Frame-Options`/`nosniff`, et le serveur de test tournait déjà avec `DEBUG=False`.
- **Comportement des nouveaux endpoints sous `DEBUG=True`** : non testé de façon dirigée — l'environnement force `DJANGO_DEBUG=0`. Observé incidemment sur une instance antérieure : page de debug Django complète sur 500, comportement standard du mode développement. Sans impact sur la production (`settings/prod.py` fixe `DEBUG = False` en dur). Aucune des trois vues ne laisse remonter d'exception non gérée en fonctionnement normal : toutes les erreurs de service sont traduites en 400/404/409/429.
- **BFF Next en exécution** : les deux Route Handlers n'ont pas été frappés via un serveur Next démarré ; relus statiquement — ils relaient les cookies via `enTetesSessionDepuis`, ré-appliquent un schéma Zod (`corpsSchema`/`resultatTentativeSchema`) et ne portent aucune logique métier (§3 respecté). Aucun chemin de contournement du paywall ajouté.
- **Refresh-token/reset/uploads** : hors surface de l'étape 6 (étapes 1 et 3), non rejoués.

---

## Verdict

**PORTE FERMÉE.**

Les trois nouveaux endpoints tiennent la checklist §8 : IDOR neutralisée par filtrage `(pk, user)` → 404 ; aucun `is_correct`/`explanation` avant soumission ; score intégralement recalculé serveur, mass-assignment ignoré ; paywall par formation renvoyant 404 à un compte `PENDING` sur QCM et examen ; anti-triche (chrono, plafond, rejeu, answers cross-quiz) effectif ; rendu XSS auto-échappé par React ; deny-by-default et journalisation propres. Aucune constatation CRITIQUE ni ÉLEVÉE ne bloque l'étape.

**Décompte final : 0 CRITIQUE · 0 ÉLEVÉ · 1 MOYEN · 2 FAIBLE.**

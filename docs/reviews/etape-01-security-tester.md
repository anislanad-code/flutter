# Étape 01 — Rapport de sécurité (agent 3 — security-tester)

**Date** : 2026-09-04 (re-test après correctif de la porte : commits `7451b90` + `bf22064` sur `origin/claude/lancer-etape-1-7cwnnz`)
**Cible** : backend Django lancé en local sur `http://127.0.0.1:8000` (settings `config.settings.dev`, `DJANGO_DEBUG=0`), Postgres 16 local `anisdev`. Revue statique + attaque des Route Handlers Next (`web/app/api/auth/*`, `web/lib/*`, `web/components/auth/FormulaireInscription.tsx`).
**Comptes montés pour l'attaque** : `victim_b_<n>@example.com` (compte cible existant), `escal_<n>@example.com` (test d'escalade + flag forcé en base), plus une série de comptes jetables (`fresh_*`, `chain_*`, `refreshtest_*`, `ratelimit_*`).
**Périmètre re-testé** : la constatation ÉLEVÉE E1 (oracle d'énumération sur `register`), le MOYEN lié M1 (`flagged_for_review` visible), et les points 3 et 6 de la checklist (non-régression). Points 2, 4, 5, 7 toujours hors périmètre à l'étape 1 (aucun contenu, vidéo, paiement, upload).

Toutes les preuves ci-dessous ont été reproduites par mes propres requêtes HTTP contre un serveur Django réel, pas par lecture des tests existants.

---

## Synthèse

| # | Point checklist | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | IDOR | Oui | Aucune surface d'IDOR à l'étape 1 (endpoints sans id de tiers) | RAS |
| 2 | Fuite de contenu | N/A | Pas de contenu à l'étape 1 | — |
| 3 | Escalade de privilèges | Oui (re-testé) | `is_staff/is_superuser/is_active/role/status/enrollment_status/flagged_for_review/score/is_free` tous ignorés | RAS |
| 4 | Contournement paywall | N/A | Pas de paywall à l'étape 1 | — |
| 5 | Vidéo | N/A | Pas de vidéo à l'étape 1 | — |
| 6 | Auth | Oui (re-testé) | **register désormais indiscernable** ; login générique ; rate limit OK ; rejeu refresh → famille révoquée | MOYEN (résidu chaîne register+login) |
| 7 | Uploads | N/A | Pas d'upload à l'étape 1 | — |
| 8 | Injection | Oui | SQLi : ORM paramétré, EmailField valide. XSS : téléphone toujours stocké brut (latent) | MOYEN |
| 9 | En-têtes / config | Oui | CORS liste blanche, DEBUG off, pas de trace, headers OK | FAIBLE |
| 10 | Journalisation | Oui | Aucun secret dans les logs applicatifs | RAS |

**Décompte : CRITIQUE 0 · ÉLEVÉ 0 · MOYEN 3 · FAIBLE 2.**

---

## Statut de l'ÉLEVÉE E1 — FERMÉE

### E1. Oracle d'énumération sur `POST /api/auth/register` — **CORRIGÉE ET VÉRIFIÉE**

Le correctif supprime toute connexion automatique à l'inscription. `RegisterView.post` (`api/apps/accounts/views.py:80-83`) renvoie **toujours** le même corps `201`, sans jamais émettre de session, de token, ni de `Set-Cookie`, que l'email existe ou non.

**Preuve 1 — réponse Django strictement identique (email connu vs inconnu).** Le compte `victim_b_<n>` a d'abord été créé, puis ré-inscrit avec un mot de passe différent (branche « email déjà pris »), comparé à un email neuf (branche « email libre ») :

```
$ curl -sD - -o body_known   -X POST /api/auth/register  -d '{"email":"victim_b_6538@example.com","phone":"0000","password":"mot-de-passe-attaquant-aleatoire-9182"}'
$ curl -sD - -o body_unknown -X POST /api/auth/register  -d '{"email":"inconnu_6538@example.com","phone":"0000","password":"mot-de-passe-attaquant-aleatoire-9182"}'

diff headers (hors Date)  -> IDENTIQUES
diff body                 -> IDENTIQUES
Set-Cookie present ?      -> h_known:0  h_unknown:0
token dans corps ?       -> b_known:0  b_unknown:0
```

Les deux réponses sont `HTTP/1.1 201 Created`, `Content-Length: 85`, corps
`{"detail":"Compte créé si l'email était disponible. Connecte-toi pour continuer."}`,
aucun en-tête `Set-Cookie`, aucun token. L'oracle binaire tokens/pas-tokens du premier rapport a disparu.

**Preuve 2 — timing indiscernable.** 8 échantillons email connu vs 8 email neuf : les deux populations se recouvrent complètement (~0,138–0,160 s), le `make_password(password)` de la branche « email déjà pris » (`services.py:103`) égalise le coût.

```
KNOWN  : .159 .157 .139 .155 .144 .144 .149 .138
UNKNOWN: .143 .139 .137 .144 .160 .149 .152 .148
```

**Preuve 3 — canal BFF Next fermé.** `web/app/api/auth/register/route.ts:54` construit une réponse neuve `NextResponse.json({detail: MESSAGE_GENERIQUE}, {status:201})` et n'appelle **jamais** `poserCookiesAuth`. `apiFetch` (`web/lib/api.ts:46-52`) ne lit que le corps JSON de Django et ne réémet jamais son `Set-Cookie`. Puisque Django renvoie désormais un `201` générique identique dans les deux cas, la branche finale du handler se déclenche à l'identique — corps, statut et absence de cookie identiques pour email connu et inconnu. Le canal précisément identifié comme fuyant au premier rapport est clos.

Règle §4.2 (« inscription… même message et même temps de réponse ») : **désormais respectée.**

---

## Statut du MOYEN lié M1 — FERMÉE

### M1 (ancien). `flagged_for_review` exposé au compte signalé — **CORRIGÉ ET VÉRIFIÉ**

`MeSerializer` (`api/apps/accounts/serializers.py:44-47`) ne liste plus `flagged_for_review`. Vérifié en base **et** en le forçant à `True` avant lecture :

```
$ manage.py shell -c "u=User.objects.get(email='escal_6538@example.com'); u.flagged_for_review=True; u.save()"
$ curl -s /api/me --cookie "access_token=<AT>"
{"id":23,"email":"escal_6538@example.com","phone":"0","is_staff":false,
 "created_at":"2026-09-04T01:36:11...","last_activity_at":"2026-09-04T01:36:44..."}
HTTP 200      # grep flagged -> 0
```

Même flaggé en base, le compte ne voit pas le signal. Conforme §4.1.6.

---

## CRITIQUE

Aucune.

---

## ÉLEVÉ

Aucune. **E1 est fermée** (preuves ci-dessus) et le re-test des points 3 et 6 n'a introduit aucune nouvelle constatation ÉLEVÉE ou CRITIQUE.

---

## MOYEN

### M-1. Résidu d'énumération inhérent à la chaîne register → login (le nouveau chemin du frontend)

- **Emplacement** : `web/components/auth/FormulaireInscription.tsx:49-58` — après un `register` toujours générique, le formulaire enchaîne `POST /api/auth/login` avec les identifiants saisis.
- **Nature** : le `register` ne fuit plus rien (E1 fermée), mais la connexion enchaînée redevient distinguable **par effet de bord** : l'attaquant qui scripte `register(email, P)` puis `login(email, P)` avec un mot de passe choisi obtient un `200` si l'email était libre (le compte vient d'être créé avec `P`) et un `401` si l'email était déjà pris (register no-op, `P` ne correspond pas). Preuve live (cache vidé) :

```
FREE  (email neuf):      reg=201  login=200
TAKEN (victim existant): reg=201  login=401
```

- **Pourquoi ce n'est PAS une réintroduction de E1** : (1) l'endpoint `register` est réellement indiscernable ; (2) l'endpoint `login` reste générique — email connu+mauvais mdp et email inconnu renvoient tous deux `401 {"detail":"Email ou mot de passe incorrect."}`, corps et en-têtes identiques (prouvé ci-dessous), donc le `login` ne trahit **pas** l'existence des comptes d'autrui ; (3) le seul signal distinctif (`login 200`) n'apparaît que lorsque l'attaquant **crée lui-même** le compte sur un email libre. Distinguer « libre » coûte donc la création d'un compte parasite sur l'email cible — bruyant, journalisé, plafonné à 20 register/15 min/IP, et c'est le plancher inhérent à tout système d'inscription par email.
- **Effet de bord plus gênant que l'énumération** : rien ne vérifie la propriété de l'email à l'inscription (l'email de bienvenue n'est pas un gate). Un attaquant peut donc **squatter préventivement** l'email d'un tiers : il « crée le compte si l'email était disponible », le vrai propriétaire reçoit ensuite le même message générique mais ne pourra jamais se connecter (mot de passe posé par l'attaquant), sans savoir pourquoi. L'accès réel au contenu restant fermé par la validation manuelle du paiement (§1), l'impact est limité à un déni d'inscription / confusion, pas à une prise de contrôle.
- **Règle** : §4.2 est respectée à la lettre (chaque endpoint est générique). C'est de la défense en profondeur.
- **Remédiation (direction)** : à traiter à l'étape « vérification d'email » — n'autoriser la connexion qu'après un lien de confirmation possédé, ce qui neutralise à la fois le résidu d'énumération et le squat. Rien à faire d'urgent à l'étape 1.

### M-2. Téléphone (et champ texte libre) stocké sans validation ni encodage — XSS stocké latent (inchangé)

- **Emplacement** : `api/apps/accounts/serializers.py:12` — `phone = CharField(max_length=32, …)` sans regex de format ; stocké brut, ré-émis brut par `MeSerializer`.
- **Constat** : le correctif de la porte n'a pas touché cette surface (le diff de `serializers.py` ne concernait que le retrait de `flagged_for_review`). La charge reste stockable ; impact **nul aujourd'hui** (rendu React échappé, aucun back-office), **différé** aux étapes 3/7 quand l'admin affichera le téléphone/nom. Reporté tel quel du premier rapport.
- **Règle enfreinte** : §8 point 8.
- **Remédiation** : valider le format à l'entrée et poser la règle « tout rendu de champ utilisateur passe par un échappement / DOMPurify » avant l'étape 7.

### M-3. Rate limit sur cache mémoire mono-process (inchangé, traçabilité)

- **Emplacement** : `api/apps/accounts/throttling.py` + `config/settings/base.py` (LocMemCache).
- **Constat** : le rate limit **fonctionne** dans le contexte testé (login 6e tentative → 429, register 21e → 429, prouvés). La limite multi-worker connue est déjà documentée et reportée à l'étape 10 (Redis obligatoire). Conservée en MOYEN pour traçabilité, non remontée comme neuve.

---

## FAIBLE

### F1. Payload de l'access token lisible en base64 — non falsifiable (inchangé)
`issue_access_token` (`tokens.py`) signe via `django.core.signing.dumps` : charge (`uid`, `sid`, `jti`) signée mais non chiffrée, donc décodable. Rien de secret dedans, altération rejetée (401). Noté pour exhaustivité.

### F2. Admin Django sur `/admin/` en dev (inchangé)
En dev, `DJANGO_ADMIN_PATH=admin` → page de login admin accessible. Conforme : `prod.py` refuse de démarrer si le chemin vaut `admin` ou est vide, et Django n'est pas exposé publiquement (§3). Aucun risque en dev local.

---

## Non-régression — preuves des contrôles re-passés

**Point 3 — Escalade.** Register avec `is_staff:true, is_superuser:true, is_active:true, role:"admin", status:"ACTIVE", enrollment_status:"ACTIVE", flagged_for_review:false, score:100, is_free:true` → `201` générique, puis vérification en base : `is_staff False, is_superuser False, is_active True, flagged False`. Le `RegisterSerializer` n'accepte que `email/phone/password` ; aucun champ de privilège n'est assignable. OK.

**Point 6 — Auth :**
- *Énumération login* : email connu+mauvais mdp et email inconnu → tous deux `401 {"detail":"Email ou mot de passe incorrect."}`, `diff` corps et en-têtes (hors Date) IDENTIQUES. OK.
- *Rate limit login* : tentatives 1-5 → 401, **6 → 429** (5/15 min/compte). OK.
- *Rate limit register* : la 21e requête sur l'IP → **429** (20/15 min/IP), observé en cours d'attaque. OK.
- *Rejeu de refresh* : rotation de R1→R2, puis rejeu de R1 → `401` **et R2 tombe ensuite → `401`** : toute la famille est révoquée (§4.2). OK.
- *`/api/me`* : n'expose que `id/email/phone/is_staff/created_at/last_activity_at` ; aucun champ interne, aucun `flagged_for_review`. OK.

**Point 8 — Injection :** `email` avec charge SQL/`<script>` → `400` (EmailField), ORM paramétré, aucun filtre/tri à cette étape. OK.

**Point 9 / 10** : inchangés depuis le premier rapport (DEBUG off, pas de trace, CORS liste blanche, headers présents ; aucun secret dans les logs applicatifs).

---

## Non testé (avec raison)

- **Points 2, 4, 5, 7** (contenu, paywall, vidéo, uploads) : aucune fonctionnalité correspondante à l'étape 1.
- **BFF Next en exécution réelle** : Next non démarré ici. La fermeture du canal E1 côté BFF est prouvée par lecture de code (`register/route.ts` ne pose jamais de cookie + `apiFetch` ne réémet pas le `Set-Cookie` de Django) et par le fait que Django renvoie une réponse strictement identique en amont — aucune information distinctive ne peut donc atteindre le handler.
- **Comportement multi-worker du rate limit** : serveur de dev mono-process ; limite déjà reportée à l'étape 10.
- **Flag `Secure` du cookie sous HTTPS réel** : vérifié par lecture (`secure:estProd`), pas par déploiement HTTPS.

---

## Verdict

**PORTE OUVERTE.**

La constatation **ÉLEVÉE E1** (oracle d'énumération sur `register`, §4.2) est **fermée**, prouvée par des requêtes réelles : réponse Django identique (statut, corps, en-têtes, absence de `Set-Cookie` et de tokens) et timing indiscernable entre email connu et inconnu, canal BFF Next également neutralisé. Le **MOYEN M1** lié (`flagged_for_review` exposé) est **fermé** (absent de `/api/me` même pour un compte flaggé en base). Le re-test des points 3 (escalade) et 6 (auth : énumération login, rate limit login/register, rejeu de refresh) n'a révélé **aucune régression ni aucune nouvelle constatation CRITIQUE/ÉLEVÉE**. Le nouvel enchaînement register→login du frontend ne réintroduit pas E1 : chaque endpoint reste générique, et le seul signal résiduel n'apparaît qu'au prix de la création effective d'un compte sur l'email sondé (résidu inhérent, classé MOYEN M-1).

**Décompte : CRITIQUE 0 · ÉLEVÉ 0 · MOYEN 3 · FAIBLE 2.**

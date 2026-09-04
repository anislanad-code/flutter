# Étape 01 — Rapport de sécurité (agent 3 — security-tester)

**Date** : 2026-09-04
**Cible** : backend Django lancé en local sur `http://127.0.0.1:8000` (settings `config.settings.dev`, `DJANGO_DEBUG=False`), Postgres 16 local `anisdev`. Revue statique du BFF Next (`web/app/api/auth/*`, `web/lib/*`, `web/middleware.ts`).
**Comptes montés pour l'attaque** : `attacker_a@example.com` (étudiant A), `victim_b@example.com` (étudiant B), plus une série de comptes jetables (`resetflow_*`, `xss_*`, `freshemail_*`). Pas de compte admin/PENDING nécessaire : aucun contenu ni inscription n'existe à l'étape 1.
**Périmètre testé** : comptes, sessions, auth (register, login, refresh, logout, logout-all, password-reset request/confirm, me). Points de checklist applicables : **1, 3, 6, 8, 9, 10**. Points **2, 4, 5, 7** hors périmètre (aucun contenu, vidéo, paiement ni upload à cette étape).

Toutes les preuves ci-dessous ont été reproduites indépendamment par mes propres requêtes, pas par lecture des tests existants.

---

## Synthèse

| # | Point checklist | Testé ? | Résultat | Pire constatation |
|---|---|---|---|---|
| 1 | IDOR | Oui | Aucune surface d'IDOR : aucun endpoint ne prend un id d'objet d'un tiers | RAS |
| 2 | Fuite de contenu | N/A | Pas de contenu à l'étape 1 | — |
| 3 | Escalade de privilèges | Oui | `is_staff/is_superuser/role/status/enrollment_status/flagged_for_review` ignorés | RAS |
| 4 | Contournement paywall | N/A | Pas de paywall à l'étape 1 | — |
| 5 | Vidéo | N/A | Pas de vidéo à l'étape 1 | — |
| 6 | Auth | Oui | Rate limit OK, replay refresh OK, reset OK, cookies OK — **mais énumération via register** | **ÉLEVÉ** (register) |
| 7 | Uploads | N/A | Pas d'upload à l'étape 1 | — |
| 8 | Injection | Oui | SQLi : ORM paramétré, EmailField valide. XSS : téléphone stocké brut (latent) | MOYEN |
| 9 | En-têtes / config | Oui | CORS liste blanche OK, DEBUG off, pas de trace, headers OK | FAIBLE |
| 10 | Journalisation | Oui | Aucun secret dans les logs applicatifs | RAS |

**Décompte** : CRITIQUE 0 · ÉLEVÉ 1 · MOYEN 2 · FAIBLE 2

---

## CRITIQUE

Aucune.

---

## ÉLEVÉ

### E1. Oracle d'énumération d'utilisateurs sur `POST /api/auth/register`

- **Emplacement** : `api/apps/accounts/views.py:55-88` (RegisterView) + `api/apps/accounts/services.py:82-107` (`enregistrer`) ; propagé fidèlement au navigateur par `web/app/api/auth/register/route.ts:47-58`.
- **Nature** : le statut HTTP est bien toujours `201` (comme prévu), mais **le corps de la réponse diffère selon que l'email existe déjà** :
  - email libre → l'enchaînement `enregistrer()` puis `connecter()` réussit → réponse `201` **avec `access_token`/`refresh_token`/`user`** (l'appelant est connecté) ;
  - email déjà pris (mot de passe soumis quelconque) → `enregistrer()` ne fait rien, `connecter()` échoue → réponse `201` **sans tokens**, corps `{"detail":"Compte créé si l'email était disponible…"}`.

  La présence/absence de tokens est un oracle binaire fiable et déterministe de l'existence du compte.

- **Preuve** :

```
$ for e in victim_b@example.com attacker_a@example.com freshemail_XXX@example.com; do
    curl -s -X POST http://127.0.0.1:8000/api/auth/register -H 'Content-Type: application/json' \
      -d "{\"email\":\"$e\",\"phone\":\"0\",\"password\":\"un-mot-de-passe-solide-123\"}"; done

victim_b@example.com        -> NO-TOKENS: Compte créé si l'email était disponible. Connecte-toi pour continuer.
attacker_a@example.com      -> TOKENS      (existe + mdp deviné dans ce test)
freshemail_XXX@example.com  -> TOKENS      (email libre)
```

  `victim_b` (compte existant, mot de passe différent de celui soumis) renvoie systématiquement `NO-TOKENS` ; tout email libre renvoie `TOKENS`. En soumettant un mot de passe aléatoire à haute entropie, `NO-TOKENS ⟺ l'email est déjà enregistré`.

  Côté navigateur, le Route Handler Next reproduit l'oracle : email libre → `201 {user}` + cookies posés (utilisateur connecté, redirigé vers `/app`) ; email pris → `201 {detail}` sans cookie. Le script attaquant distingue trivialement les deux cas.

- **Impact** : un attaquant énumère quels emails possèdent un compte sur la plateforme — c'est-à-dire **qui est client de anis.dev** (donnée personnelle : appartenance à une formation payante), utile pour du phishing ciblé et du credential-stuffing. Le timing, lui, ne trahit rien (voir ci-dessous) : la faille est dans la forme de la réponse, pas dans sa durée.
- **Règle enfreinte** : CLAUDE.md §4.2 — « Pas d'énumération d'utilisateurs : connexion, inscription et reset renvoient le **même message** et le même temps de réponse, que le compte existe ou non. » Le login et le reset respectent cette règle (prouvé plus bas) ; **le register non**.
- **Facteur atténuant** (ne referme pas la faille) : `register:ip` limite à 20/15 min/IP (`views.py:62`), et l'IP vue par Django est celle du navigateur relayée par Next — l'énumération est ralentie (~80 emails/h/IP) mais reste possible et scriptable.
- **Remédiation (direction, pas patch)** : rendre les deux branches indiscernables. Ne jamais auto-connecter à l'inscription : renvoyer toujours la même réponse `201` sans tokens (« compte créé si l'email était disponible, connecte-toi »), et forcer un `login` explicite ensuite. L'auto-login sur register est ce qui crée l'oracle.

---

## MOYEN

### M1. Téléphone (et tout champ texte libre) stocké sans encodage de sortie — XSS stocké latent

- **Emplacement** : `api/apps/accounts/serializers.py:12` (`phone = CharField`, aucune validation de forme), stocké tel quel (`services.enregistrer` → `User.objects.create_user`), ré-émis brut par `MeSerializer` (`serializers.py:38-50`).
- **Preuve** :

```
$ curl -s -X POST http://127.0.0.1:8000/api/auth/register -H 'Content-Type: application/json' \
    -d '{"email":"xss_...@example.com","phone":"<script>alert(1)</script>","password":"un-mot-de-passe-solide-123"}'
phone stored as: '<script>alert(1)</script>'   # renvoyé brut dans /api/me
```

- **Impact aujourd'hui : nul.** La valeur ne transite qu'en JSON et le front la rend via React (échappement automatique) ; aucune exécution à l'étape 1. **Le risque est différé** : dès que le back-office admin (étape 7) affichera le téléphone/nom d'un étudiant, ou qu'un email transactionnel l'interpolera en HTML, ce payload s'exécutera. C'est une charge stockée qui attend son point de rendu.
- **Règle enfreinte** : CLAUDE.md §8 point 8 (XSS stocké dans les champs texte libre) — défense en profondeur absente au stockage.
- **Remédiation** : valider le format du téléphone à l'entrée (regex chiffres/`+`/espaces) et poser dès maintenant la règle « tout rendu de champ utilisateur passe par un échappement/DOMPurify », à faire respecter aux étapes 3 et 7.

### M2. Rate limit du login uniquement par cache mémoire mono-process

- **Emplacement** : `api/apps/accounts/throttling.py` + `config/settings/base.py:144-148` (LocMemCache).
- **Constat** : le rate limit **fonctionne réellement** dans le contexte testé (6e tentative de login = 429, prouvé plus bas). La limite connue multi-worker (seuil × nombre de workers) est déjà documentée dans `throttling.py` et reportée à l'étape 10 — je ne la remonte pas comme neuve, conformément à la consigne. Je la conserve en MOYEN uniquement pour traçabilité : à l'étape 10, brancher Redis est obligatoire, sinon le rate limit anti-bruteforce du §4.2 devient contournable en prod multi-worker.

---

## FAIBLE

### F1. Payload du access token lisible en clair (base64) — non falsifiable

- `issue_access_token` (`tokens.py:32-38`) utilise `django.core.signing.dumps` : la charge (`uid`, `sid`, `jti`) est signée mais **non chiffrée**, donc décodable en base64. Elle ne contient rien de secret (id utilisateur + id session, déjà des bearer values) et toute altération est rejetée (`garbage.notvalid` → 401, prouvé). Aucune action requise ; noté pour exhaustivité.

### F2. Admin Django monté sur `/admin/` en dev

- En dev, `DJANGO_ADMIN_PATH=admin` → `GET /admin/` répond `302` (page de login admin accessible). C'est **conforme** : `prod.py:22-26` refuse de démarrer si le chemin vaut `admin` ou est vide, et Django n'est pas exposé publiquement (§3). Aucun risque en dev local (bind `127.0.0.1`). Noté pour mémoire ; rien à corriger à l'étape 1.

---

## Résultats détaillés (preuves) des contrôles PASSÉS

**Point 3 — Escalade de privilèges.** Register avec `is_staff:true, is_superuser:true, is_active:true, role:"admin", status:"ACTIVE", enrollment_status:"ACTIVE", flagged_for_review:false` → compte créé avec `"is_staff":false`. Le `RegisterSerializer` n'expose que `email/phone/password` ; le `MeSerializer` a `read_only_fields = fields`. Aucun champ de privilège n'est assignable.

**Point 1 — IDOR.** Aucun endpoint de l'étape 1 ne prend l'id d'un objet d'un tiers (register/login/refresh/logout/reset sans auth ; `/me` et `logout-all` renvoient/agissent sur `request.user`). Le refresh et le logout consomment un refresh token qui est un secret bearer : le posséder, c'est être cette session (ce n'est pas une IDOR). Surface d'IDOR = néant à cette étape.

**Point 6 — Auth :**
- *Énumération login* : email existant (mauvais mdp) et email inexistant renvoient tous deux `401 {"detail":"Email ou mot de passe incorrect."}`. Timing médian sur 15 échantillons : existant **2,2 ms** vs inexistant **2,3 ms** (le `check_password` sur hachage fictif de `services.py:34,118` égalise). OK.
- *Énumération reset* : compte existant et inexistant renvoient tous deux `200` + message générique identique. L'email n'est envoyé que si le compte existe (0 email console pour un email inexistant). OK.
- *Rate limit login* : tentatives 1-5 → 401, **tentative 6 → 429** (seuil 5/15 min/compte). OK.
- *Rate limit reset* : la 4e requête (>3/h) renvoie tout de même `200` générique (anti-énumération volontaire, `views.py:182-184`) mais **n'envoie plus d'email** — throttle effectif, juste non observable par le statut. OK.
- *Rejeu de refresh* : rotation d'un refresh, puis rejeu de l'ancien secret → `401` **et toute la famille tombe** : le nouveau secret rotaté est aussi invalidé ensuite (`401`). Conforme §4.2. OK.
- *Reset → révocation de sessions + usage unique* : session S1 valide (`/me` 200) ; après `password-reset/confirm` (204), S1 → `401` ; réutilisation du token de reset → `400` ; login avec le nouveau mot de passe → `200`. OK.
- *Cookies (BFF Next, `web/lib/auth-cookies.ts:24-37`)* : `httpOnly:true`, `sameSite:"strict"`, `secure:estProd` (donc `true` en build de production, `false` en dev sans HTTPS — acceptable). Les trois flags sont posés. Les Route Handlers Next (`login/register/refresh`) ne renvoient au navigateur que `{user}` : **aucune valeur brute de `access_token`/`refresh_token` dans le corps JSON** exposé au navigateur — les tokens deviennent des cookies httpOnly côté serveur, jamais du JSON pour le client. Le canal Django→Next en JSON (§3) est distinct et légitime. OK.

**Point 8 — Injection :**
- SQLi via `email` : `EmailField` rejette (`400 "Saisissez une adresse e-mail valide."`), et l'ORM est paramétré. Aucun paramètre de filtre/tri n'existe à l'étape 1. OK.
- Email avec `<script>` → `400` (rejeté par la validation email). OK.
- Access token malformé (`garbage.notvalid`, vide) → `401`, pas de 500. OK.

**Point 9 — En-têtes / config :**
- `DEBUG=False` : corps JSON invalide → `{"detail":"JSON parse error…"}`, méthode interdite → `405 {"detail":"Méthode « GET » non autorisée."}`, **aucune trace de pile** renvoyée. OK.
- CORS : origine en liste blanche (`http://localhost:3000`) reflétée avec `allow-credentials:true` ; origine `https://evil.example` **non reflétée** en préflight comme en requête réelle (pas d'`Access-Control-Allow-Origin`). `CORS_ALLOW_ALL_ORIGINS=False`. OK.
- Headers Django : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`. La CSP est posée par le middleware Next (revue statique : `default-src 'self'`, nonce + `strict-dynamic`, `frame-ancestors 'none'`). OK.

**Point 10 — Journalisation :** balayage du log serveur complet de la session pour `password`, `refresh`, `access_token`, secrets de mot de passe → aucun secret dans les logs applicatifs. Le token de reset apparaît dans la sortie console **uniquement** parce que le dev utilise `console.EmailBackend` : c'est le corps de l'email (canal de livraison), pas une trace applicative. En prod, `EMAIL_BACKEND` est un vrai SMTP (`prod.py:28`). OK.

---

## Non testé (avec raison)

- **Points 2, 4, 5, 7** (fuite de contenu, paywall, vidéo, uploads) : aucune fonctionnalité correspondante n'existe à l'étape 1 (contenu = étape 2, paiement/upload = étape 3, vidéo = étape 4). Rien à attaquer.
- **Comportement multi-worker du rate limit** : non reproduit (serveur de dev mono-process). Limite déjà documentée et reportée à l'étape 10 ; non remontée comme neuve.
- **Flag `Secure` du cookie sous HTTPS réel** : vérifié par lecture de code (`secure:estProd`), pas par un déploiement HTTPS. En dev local (HTTP), `Secure` est volontairement `false`.
- **Énumération via le Route Handler Next en conditions réelles** : Next non démarré ici ; l'oracle E1 est prouvé au niveau Django et le handler `register/route.ts` le propage fidèlement (lecture de code). Impact identique côté navigateur.

---

## Verdict

**PORTE FERMÉE.**

Une constatation **ÉLEVÉE** (E1 — oracle d'énumération d'utilisateurs sur `register`, violation directe de CLAUDE.md §4.2) bloque l'étape 1. Les priorités demandées par `progress.md` — points 6 (auth) et 3 (escalade) — sont solides **à une exception près, décisive, sur l'anti-énumération de l'inscription**.

**Décompte : CRITIQUE 0 · ÉLEVÉ 1 · MOYEN 2 · FAIBLE 2.**

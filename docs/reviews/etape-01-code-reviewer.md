# Étape 01 — Revue de code

**Date** · 2026-09-04 (revue initiale) · **révisée le 2026-09-04** après les correctifs `7451b90` et `bf22064`.
**Branche relue** · `claude/lancer-etape-1-7cwnnz`. Revue initiale sur `9c655bc`, `95c9885` (diff `2accd59..95c9885`, 67 fichiers, +4074 / −9). Contre-revue sur `95c9885..HEAD` — 31 fichiers, +2975 / −195, dont `7451b90` (« sec: corriger l'oracle d'énumération au register et le contraste AA ») et `bf22064` (« fix: gérer l'échec réseau sur mot de passe oublié et déconnexion »).
**Périmètre** · `api/apps/accounts/**`, `api/apps/enrollment/models.py` + migration, `api/config/settings/base.py`, `api/config/urls.py`, `web/app/api/auth/**`, `web/app/api/me`, `web/lib/{auth-cookies,auth-cookie-names,auth-schemas,client-ip,current-user}.ts`, `web/middleware.ts`, `web/components/auth/**`, `web/app/(auth|student|admin)/**`, `web/tests/**`, `.github/workflows/ci.yml`.
**Objet de la contre-revue** · vérification des 3 BLOQUANT et du MAJEUR 6. Les autres remarques n'ont pas été rejouées ligne à ligne ; elles sont reconduites telles quelles.

## Commandes exécutées et résultat brut (contre-revue, sur `HEAD`)

| Commande | Résultat |
|---|---|
| `ruff check .` | `All checks passed!` |
| `ruff format --check .` | `66 files already formatted` |
| `mypy apps config` (strict, plugins django/drf) | `Success: no issues found in 61 source files` |
| `python manage.py makemigrations --check --dry-run` | `No changes detected` — aucune migration orpheline |
| `pytest apps/accounts/tests/test_register.py` | **toujours non exécutable ici** : pas de PostgreSQL joignable dans l'environnement de revue (`FATAL: password authentication failed`), pas de démon Docker. 5 erreurs de connexion, 0 échec d'assertion. Laissé à l'agent 2. |
| `npm run lint` | vert, aucune sortie |
| `npx tsc --noEmit` | vert, aucune sortie |
| `npm run test` | `Test Files 15 passed (15)` · `Tests 216 passed (216)` (contre 13 / 188 à la revue initiale) |
| `npm run test:cov` | `Statements 99.38 %` · `Branches 99.39 %` · `Functions 96.07 %` · `Lines 100 %` (contre 88,58 % — MINEUR 14 résolu) |
| `npm run build` | vert. 18 routes, **toutes `ƒ` sauf `○ /icon.svg`**. La première ligne reste préfixée `┌`. |
| Garde CI rejoué sur la sortie réelle de `npm run build` | ne se déclenche pas (pas de faux positif) |
| Garde CI rejoué sur la même sortie avec `┌ ƒ /` muté en `┌ ○ /`, en locale `C` **et** `en_US.UTF-8` | **se déclenche dans les quatre cas** — voir BLOQUANT 2 |
| `grep -rn "text-muted" web/{app,components}` | plus aucune occurrence dans le périmètre de l'étape 1 ; il reste 6 occurrences dans `app/(marketing)/page.tsx` (page palette de l'étape 0, hors périmètre) |

---

## BLOQUANT — les trois sont levés

### 1. `POST /api/auth/register` était un oracle d'énumération — **RÉSOLU**

- **Vérifié à** : `api/apps/accounts/views.py:55-83`, `api/apps/accounts/services.py:82-108`, `web/app/api/auth/register/route.ts:25-55`, `web/components/auth/FormulaireInscription.tsx:23-61`.
- **Constat** : `RegisterView.post` n'appelle plus `services.connecter()`. Les deux seuls chemins de sortie possibles après la validation du mot de passe sont un unique `Response({"detail": …}, status=201)` (`views.py:80-83`) — une seule instruction, littéralement le même objet construit dans les deux cas. Côté service, `enregistrer()` renvoie `None` dans les deux branches (`services.py:104` et `services.py:106-108`) et n'expose plus rien de discriminant. Côté BFF, `register/route.ts` n'importe plus `poserCookiesAuth` ni `sessionEmiseSchema` et se termine sur un `NextResponse.json({ detail: MESSAGE_GENERIQUE }, { status: 201 })` inconditionnel : plus aucun `Set-Cookie`, plus de corps `{user}`. Aucun code résiduel de l'ancienne branche.
- **Preuves de non-régression** : `api/apps/accounts/tests/test_register.py:61-78` compare `reponse_prise.data == reponse_libre.data` et l'égalité des statuts ; `web/tests/auth-routes.test.ts:45-64` vérifie l'absence des cookies `session` et `refresh` sur le chemin nominal ; `web/tests/auth-routes.test.ts:66-88` compare les deux réponses du BFF. Les 216 tests web passent.
- **Effet de bord favorable** : **MAJEUR 1 tombe du même coup**. `register` ne vérifie plus aucun mot de passe, donc il n'est plus un endpoint de connexion échappant au compteur `login:account`.
- **Réserve reportée** : le canal *temporel* n'est pas égalisé (voir MAJEUR 10). L'oracle déterministe, à une requête, sur la forme de la réponse, lui, a disparu.

### 2. Le garde CI « Aucune route prérendue en statique » ratait la première ligne — **RÉSOLU**

- **Vérifié à** : `.github/workflows/ci.yml:132` (`grep -E "○" | grep -E "/" | grep -qvE "/icon\.svg"`).
- **Constat** : l'ancrage sur les caractères d'arbre est abandonné, donc la question du `┌` manquant ne se pose plus. Le filtre `grep -E "/"` écarte la ligne de légende `○  (Static)   prerendered as static content`, qui ne contient aucun `/` — je l'ai vérifié sur la sortie réelle du build, pas sur une supposition. Le `grep -qv` final conserve la bonne sémantique : code 0 seulement s'il subsiste une ligne autre que `/icon.svg`, code 1 si le premier `grep` ne produit rien.
- **Preuve d'efficacité** : j'ai capturé la sortie réelle de `npm run build`, muté `┌ ƒ /` en `┌ ○ /` — c'est-à-dire exactement la régression que l'ancienne version laissait passer — et rejoué la commande telle quelle : **détectée**, en locale `C` comme en `en_US.UTF-8`. Sur la sortie non mutée, aucun déclenchement dans les deux locales. Le raisonnement du commentaire (`ci.yml:121-131`) sur les octets multi-octets hors bracket expression est exact.
- **Résidu connu, non bloquant** : voir MINEUR 8 (l'absence de `pipefail` fait que l'échec du `npm run build` de cette ligne reste masqué par le statut du `grep`).

### 3. Contraste AA du texte secondaire — **RÉSOLU dans le périmètre de l'étape 1**

- **Vérifié à** : `web/app/(auth)/connexion/page.tsx:19`, `web/app/(auth)/inscription/page.tsx:14,19`, `web/app/(auth)/mot-de-passe-oublie/page.tsx:14`, `web/app/(student)/app/page.tsx:23`, `web/app/(admin)/admin/page.tsx:23`, `web/components/auth/FormulaireInscription.tsx:97`, `web/components/auth/FormulaireNouveauMotDePasse.tsx:70`.
- **Constat** : les sept paragraphes sont passés de `text-muted` à `text-ink` (`#14201E` sur `#FAFAF7`, très au-dessus de 4,5:1). Un `grep -rn "text-muted"` sur `web/app` et `web/components` ne renvoie plus rien dans le périmètre de l'étape ; les seules occurrences restantes sont dans `app/(marketing)/page.tsx` (la page palette de l'étape 0), hors périmètre — à traiter à l'étape 2, quand cette page deviendra la vraie landing.
- **Choix approuvé** : ne pas toucher à la valeur de `--muted`. Le §6 fige les cinq valeurs ; corriger l'usage plutôt que le token est la bonne lecture, et elle ne demande pas d'accord sur une décision figée.
- **Point non couvert par le correctif** : les usages non textuels de `--muted` restent en dessous du seuil « composants d'interface ». Voir MAJEUR 11 — c'est un critère différent (1.4.11, non-texte), pas celui qui bloquait.

---

## MAJEUR

**Résolus par les correctifs** : MAJEUR 1 (le register n'exécute plus de connexion, donc plus de contournement du compteur `login:account`), MAJEUR 6 (`flagged_for_review` retiré), MAJEUR 8 (le cas « email déjà pris » affiche désormais un message).

Détail de la vérification de MAJEUR 6 : `MeSerializer.Meta.fields` (`api/apps/accounts/serializers.py:46`) énumère `["id", "email", "phone", "is_staff", "created_at", "last_activity_at"]` — `flagged_for_review` est absent, et un commentaire de classe (`serializers.py:39-42`) consigne la raison. Le schéma zod `utilisateurSchema` (`web/lib/auth-schemas.ts:5-14`) est aligné, avec le même commentaire. Le champ ne peut plus atteindre `/api/me`. Note : les objets zod sont non-stricts par défaut, donc si Django réintroduisait le champ, le front l'ignorerait silencieusement plutôt que d'échouer — c'est le bon comportement ici, mais le garde-fou réel est côté Django, pas côté zod.

Détail de la vérification de MAJEUR 8 : `FormulaireInscription.tsx:55-58` teste `!connexion.ok` et affiche « Compte créé. Connecte-toi pour continuer. ». L'aller-retour muet `/app` → `/connexion` a disparu, et `web/tests/composants-auth.test.tsx:269-278` le fige. Voir toutefois MINEUR 15 sur l'habillage de ce message.

**Reconduits sans changement** (non rejoués ligne à ligne, voir la revue initiale pour le détail) :

### 2. Aucun code n'appelle jamais `/api/auth/refresh` : la session meurt au bout de 15 minutes
`web/app/api/auth/refresh/route.ts` · `web/lib/current-user.ts:10-22` · `web/middleware.ts:34-37`. Toujours du code mort, et le cookie refresh de 7 jours n'est jamais présenté.

### 3. `device_fingerprint` vaut la même chose pour tout le monde
`api/apps/accounts/views.py:45-48` · `web/lib/api.ts:34-44`. Aucune requête de `web/` n'émet `X-Device-Fingerprint` ni ne relaie le `User-Agent` du navigateur.

### 4. La limite par IP est soit globale, soit contournable, selon le déploiement — et rien ne le dit
`web/lib/client-ip.ts:5-9` · `api/apps/accounts/utils.py:14-19`.

### 5. `logout` révoque une session par son identifiant sans vérifier le secret
`api/apps/accounts/services.py:184-191` (`session_id, _secret = parsed` puis `filter(pk=session_id).update(...)`) · `views.py:146-150`. Inchangé par les correctifs.

### 7. Les formulaires client consomment les réponses JSON sans Zod, en `any` implicite
`web/components/auth/FormulaireInscription.tsx:29-32` · `web/components/auth/FormulaireNouveauMotDePasse.tsx:33-38`. Toujours `await reponse.json().catch(() => ({}))` puis lecture de `corps.password`. À noter que le BFF alimente ce chemin en relayant tel quel le corps 400 de Django (`web/app/api/auth/register/route.ts:51`, `result.data as Record<string, unknown>`), sans schéma : la forme n'est validée nulle part sur toute la chaîne.

### 9. Les deux emails partent en `fail_silently=True`
`api/apps/accounts/emails.py:20` et `:35`.

**Nouveaux, constatés pendant la contre-revue** (aucun n'est introduit par les correctifs ; les deux sont des angles morts de la revue initiale) :

### 10. Le canal temporel distingue toujours un compte connu d'un compte inconnu, sur `register` **et** sur `password-reset/request`

- **Emplacement** : `api/apps/accounts/services.py:101-108` ; `api/apps/accounts/services.py:198-209` ; `api/apps/accounts/emails.py:11-21` et `:24-36` ; `api/config/settings/prod.py:28`.
- **Constat** : dans les deux services, l'envoi d'email n'a lieu **que** dans la branche « le compte existe » (register : compte nouvellement créé ; reset : compte trouvé). `send_mail` est synchrone, dans le fil de la requête, et pour `enregistrer()` il est même à l'intérieur du `@transaction.atomic`. Le chemin « email déjà pris » du register se contente d'un `make_password(password)` (`services.py:103`) pour égaliser le coût Argon2 — l'intention est là, mais elle ne couvre ni les deux `INSERT` (`User` + `Enrollment`) ni le `send_mail`. Le chemin « compte inconnu » du reset, lui, n'égalise rien du tout : il sort en deux lignes (`services.py:202-203`) là où l'autre branche crée un `PasswordResetToken` et envoie un email. En dev, `EMAIL_BACKEND` vaut le backend console (`dev.py:12`) et la différence est invisible — c'est exactement dans cette configuration que la porte de sécurité a mesuré « 2,2 ms vs 2,3 ms » (`docs/reviews/etape-01-security-tester.md:114`). En production, `EMAIL_BACKEND` vient de l'environnement (`prod.py:28`) et sera un backend SMTP : une poignée d'allers-retours réseau, soit un écart de plusieurs dizaines à plusieurs centaines de millisecondes, mesurable en une seule requête.
- **Règle enfreinte** : CLAUDE.md §4.2 — « connexion, inscription et reset renvoient le même message **et le même temps de réponse**, que le compte existe ou non ».
- **Conséquence** : l'énumération redevient possible, moins commodément (il faut chronométrer au lieu de lire un cookie), mais sans statistiques si le SMTP est distant. Le soin mis à égaliser Argon2 sur `connecter()` (`services.py:34,118-120`) est annulé par un facteur mille fois plus lourd sur les deux autres endpoints.
- **Piste** : ce qui coûte cher et ne concerne qu'une des deux branches n'a pas sa place dans le fil de la requête ; et le chronométrage doit être refait par l'agent 3 avec un backend email représentatif de la production, pas avec le backend console.

### 11. La bordure des champs de saisie est à 1,90:1 — en dessous du seuil « composants d'interface »

- **Emplacement** : `web/components/auth/ChampTexte.tsx:37` (`border border-muted/50 bg-paper`) ; même motif sur `web/components/auth/BoutonDeconnexion.tsx:27`.
- **Constat** : le champ n'a pas de fond distinct (`bg-paper` sur fond `paper`) — sa seule limite visuelle est la bordure. Celle-ci est `--muted` (`#6E7B78`) à 50 % d'opacité sur `--paper` (`#FAFAF7`), soit une couleur composite d'environ `#B4BAB8`. Contraste calculé contre le fond : **1,90:1**. Le seuil AA pour un composant d'interface dont la limite porte l'information est 3:1. À pleine opacité, `--muted` sur `--paper` donne 4,36:1 et passerait largement ; c'est l'opacité 50 % qui fait tomber la valeur, pas le token.
- **Règle enfreinte** : CLAUDE.md §6 — « Plancher de qualité, non négociable : […] contraste AA », et le §6 exige aussi que l'écran soit utilisable sur un Android en conditions moyennes.
- **Conséquence** : sur un écran de téléphone à luminosité réduite, les champs email et mot de passe sont des rectangles quasi invisibles — sur l'écran de connexion, c'est-à-dire la première interaction de tout étudiant avec la plateforme. Le composant `ChampTexte` est le champ de saisie générique du projet : il portera aussi les formulaires des étapes 3 et 6.
- **Piste** : ce n'est pas le critère de contraste de texte qui bloquait l'étape, mais c'est le même plancher §6 ; la limite d'un champ de saisie doit être perceptible sans dépendre de l'opacité.

---

## MINEUR

**Résolus** : MINEUR 14 (couverture web remontée de 88,58 % à 99,38 % d'instructions, 100 % de lignes).

**Reconduits** :

1. **Index inutile, index manquant.** `api/apps/accounts/models.py:85` indexe `(user, used_at)` sur `PasswordResetToken`, alors que la seule requête réelle est `filter(token_hash=…)` (`services.py:219-225`), sur une colonne non indexée.
2. **Le compteur de connexion décompte aussi les réussites.** `views.py:98` incrémente avant vérification, `throttling.py:24-33` ne remet jamais à zéro. Corollaire connu : cinq échecs délibérés verrouillent le compte d'un tiers 15 minutes. Voir MINEUR 17, que le nouveau flux d'inscription ajoute à ce tableau.
3. **Aucune invalidation des jetons de réinitialisation antérieurs.** `services.py:198-209` : jusqu'à trois liens valides simultanément par heure.
4. **Effet de bord dans la transaction.** `services.py:108` envoie l'email de bienvenue à l'intérieur du `@transaction.atomic`. Toujours vrai, et désormais aussi la cause de MAJEUR 10.
5. **`assert isinstance(request.user, User)`** en `views.py:159` et `views.py:214` : disparaît sous `python -O`.
6. **`effacerCookiesAuth`** (`web/lib/auth-cookies.ts:40-43`) réécrit les cookies sans `httpOnly`/`secure`/`sameSite`, contrairement à `poserCookiesAuth`.
7. **Duplication du nom de cookie Django.** `access_token=` écrit dans `web/lib/current-user.ts:16`, `web/app/api/me/route.ts:18`, `web/app/api/auth/logout-all/route.ts:17` ; et `current-user.ts:14-22` duplique presque mot pour mot `api/me/route.ts:16-32`.
8. **CI : second `npm run build` sans `pipefail`.** `.github/workflows/ci.yml:132` reconstruit tout après l'étape `build` (ligne 116), et le `run` par défaut de GitHub Actions n'active pas `pipefail` : si ce `npm run build` échouait, le statut du `grep` final masquerait l'échec et l'étape passerait au vert. Le correctif du BLOQUANT 2 a laissé ce point intact.
9. **`password-reset/request` ment quand Django est injoignable.** `web/app/api/auth/password-reset/request/route.ts:20-27`.
10. **Pas de message de succès sur le chemin nominal.** « Créer mon compte » (`FormulaireInscription.tsx:112`) redirige vers `/app` sans rien confirmer, « Changer le mot de passe » (`FormulaireNouveauMotDePasse.tsx:79`) idem. §6 : le message de succès reprend le verbe du bouton.
11. **Navigation interne en `<a href>`** plutôt qu'en `<Link>` : `app/(auth)/connexion/page.tsx:21`, `app/(auth)/inscription/page.tsx:21`, `components/auth/FormulaireConnexion.tsx:80-85`.
12. **`Enrollment` sans contrainte d'unicité ni index** (`api/apps/enrollment/models.py:10-33`). À reprendre à l'étape 2 avec `Course`.
13. **Focus visible partiel.** `ChampTexte.tsx:37` traite le cas des champs ; les boutons et liens s'en remettent au contour par défaut du navigateur, peu lisible sur `bg-zellige`.

**Nouveaux** :

14. *(numéro libéré — l'ancien MINEUR 14 sur la couverture est résolu.)*
15. **Un message rassurant peint en rouge d'erreur.** `web/components/auth/FormulaireInscription.tsx:55-57` place « Compte créé. Connecte-toi pour continuer. » dans `erreurGenerale`, rendu par `FormulaireInscription.tsx:101-105` en `text-danger` avec `role="alert"`. La phrase annonce une réussite partielle, la couleur annonce un échec. Le même canal sert aussi quand la connexion échoue pour une raison sans rapport (429, 503, coupure réseau) : l'utilisateur lit alors « Compte créé » alors que rien ne le garantit. §6 : « Les erreurs disent quoi corriger, elles ne s'excusent pas » — et une réussite n'est pas une erreur.
16. **Test tautologique côté BFF.** `web/tests/auth-routes.test.ts:66-88` (« renvoie la même réponse […] que l'email existe déjà ou non ») configure `apiFetch.mockResolvedValue` **une seule fois**, donc les deux appels reçoivent par construction la même réponse amont. Le test prouve que la route est déterministe, pas qu'elle n'introduit pas d'écart — l'invariante réelle est tenue par `api/apps/accounts/tests/test_register.py:61-78`, côté Django. À reformuler pour qu'il vérifie ce que son nom promet.
17. **L'inscription consomme désormais le quota de connexion du compte visé.** `web/components/auth/FormulaireInscription.tsx:49-53` enchaîne un `POST /api/auth/login` après chaque inscription. Combiné au MINEUR 2 (le compteur ne se remet jamais à zéro, même sur succès), cinq soumissions du formulaire d'inscription avec un email existant suffisent à verrouiller `login:account` pour ce compte pendant 15 minutes — sans jamais passer par la page de connexion. Le choix reste le bon (c'est ce qui supprime l'oracle), mais le chemin de verrouillage est nouveau et mérite d'être connu avant l'étape 3.

---

## Verdict

**PORTE OUVERTE** du point de vue de la revue de code.

Les trois BLOQUANT sont levés, et vérifiés sur le code, pas sur la note de correctif :

- l'inscription ne produit plus qu'une seule réponse possible, construite par une unique instruction côté Django et relayée sans branche côté BFF, sans cookie dans aucun cas ; deux tests, un de chaque côté, figent l'égalité ;
- le garde CI a été rejoué sur la sortie réelle du build et sur cette même sortie mutée en régression, dans deux locales : il attrape maintenant la première ligne du tableau — celle de `/`, la seule pour laquelle il avait déjà échoué — et ne produit pas de faux positif ;
- plus aucun `text-muted` ne porte du texte dans le périmètre de l'étape, et le token `--muted` n'a pas été touché, ce qui était la bonne décision au regard du §6.

Trois remarques d'un rang inférieur tombent en prime : MAJEUR 1 (le register n'est plus un endpoint de connexion officieux), MAJEUR 8 (le cas « email déjà pris » parle enfin) et MINEUR 14 (couverture web à 99,38 %). `ruff`, `ruff format`, `mypy --strict`, `eslint`, `tsc --noEmit`, `makemigrations --check` et les 216 tests web sont verts ; aucune migration n'a été touchée par les correctifs, aucun code mort n'a été laissé derrière la réécriture de `register/route.ts`.

Deux réserves, qui ne ferment pas la porte mais qui ne doivent pas se perdre. La première est le prolongement direct du BLOQUANT 1 : le corps de réponse est égalisé, le **temps** ne l'est pas, parce que `register` comme `password-reset/request` n'envoient un email que dans la branche « le compte existe », de façon synchrone, et que la mesure qui a validé ce point a été faite avec le backend email console. C'est le MAJEUR 10, et c'est à l'agent 3 de trancher son rang après un chronométrage représentatif de la production. La seconde est le MAJEUR 11 : la correction du contraste a porté sur le texte, mais la bordure des champs de saisie reste à 1,90:1, sur le composant qui portera tous les formulaires du projet.

Enfin, ce verdict n'engage que cette revue : la sortie d'étape reste conditionnée aux rapports des agents 2 et 3, et à la case datée dans `progress.md`.

**Remarques restantes : 0 BLOQUANT · 8 MAJEUR (6 reconduits + 2 nouveaux) · 16 MINEUR (13 reconduits + 3 nouveaux).**

# Étape 01 — Revue de code

**Date** · 2026-09-04
**Branche relue** · `claude/lancer-etape-1-7cwnnz` (commits `9c655bc`, `95c9885`), diff `2accd59..HEAD` — 67 fichiers, +4074 / −9.
**Périmètre** · `api/apps/accounts/**`, `api/apps/enrollment/models.py` + migration, `api/config/settings/base.py`, `api/config/urls.py`, `web/app/api/auth/**`, `web/app/api/me`, `web/lib/{auth-cookies,auth-cookie-names,auth-schemas,client-ip,current-user}.ts`, `web/middleware.ts`, `web/components/auth/**`, `web/app/(auth|student|admin)/**`, `web/tests/**`, `.github/workflows/ci.yml`.

## Commandes exécutées et résultat brut

| Commande | Résultat |
|---|---|
| `ruff check .` (0.8.6 épinglé, venv 3.12) | `All checks passed!` |
| `ruff format --check .` | `64 files already formatted` |
| `mypy apps config` (strict, plugins django/drf) | `Success: no issues found in 59 source files` |
| `python manage.py makemigrations --check --dry-run` | `No changes detected` — aucune migration orpheline, modèles et migrations cohérents |
| `pytest` | **non exécutable ici** : aucun PostgreSQL accessible dans l'environnement de revue (`FATAL: password authentication failed`), pas de démon Docker. 64 tests sans base passent, 99 erreurs de connexion. Laissé à l'agent 2. |
| `npm run lint` | vert, aucune sortie |
| `npx tsc --noEmit` | vert, aucune sortie |
| `npm run test` | `Test Files 13 passed (13)` · `Tests 188 passed (188)` |
| `npm run test:cov` | `Statements 88.58 %` · `Branches 87.19 %` · `Functions 80.39 %` · `Lines 89.9 %` |
| `npm run build` | vert. Tableau de routes : **18 routes, toutes `ƒ` sauf `○ /icon.svg`**. La première ligne du tableau est préfixée `┌` (voir BLOQUANT 2). |
| `grep -rn "TODO\|FIXME\|print(\|breakpoint(" api/apps` | aucun (seuls des faux positifs sur `fingerprint(`) |
| `grep -rn "console.log\|TODO\|FIXME\| any " web/{app,components,lib}` | aucun |
| `grep -rn "__all__" api/apps` | aucun `fields = '__all__'` — §7 respecté |
| `grep -rnE "#[0-9a-f]{3,8}" web/{app,components}` | aucun ; les seuls hexadécimaux sont dans `web/lib/design-tokens.ts` (page palette de l'étape 0) |

Le socle est propre : lint, types et migrations sont réellement verts, les serializers sont explicites champ par champ, la logique métier est bien dans `apps/accounts/services.py` et les vues ne font qu'orchestrer, chaque transition d'état (`enregistrer`, `rafraichir`, `confirmer_reinitialisation`) est atomique. Ce qui suit est ce qui ne va pas.

---

## BLOQUANT

### 1. `POST /api/auth/register` est un oracle d'énumération d'utilisateurs

- **Emplacement** : `api/apps/accounts/views.py:66-88` ; `web/app/api/auth/register/route.ts:47-54` ; comportement figé en test dans `api/apps/accounts/tests/test_register.py:52-54`.
- **Constat** : la vue appelle `services.enregistrer()`, puis enchaîne `services.connecter()`. Si l'email était libre, la réponse est `201` avec `access_token` / `refresh_token` / `user` ; si l'email appartenait déjà à quelqu'un, `connecter()` échoue et la réponse est `201 {"detail": "Compte créé si l'email était disponible…"}`. Le BFF reproduit fidèlement les deux formes : `201 {"user": …}` + deux `Set-Cookie`, contre `201 {"detail": …}` sans cookie. Le test `test_l_inscription_avec_un_email_deja_pris_ne_cree_pas_de_doublon` assume explicitement cette différence (`assert "access_token" not in reponse.data`). Un attaquant envoie l'email cible avec un mot de passe aléatoire et lit la présence du cookie : il sait avec certitude si le compte existe. Les temps de réponse divergent aussi (chemin « email libre » = `make_password` + `INSERT` user + `INSERT` enrollment + envoi d'email + `check_password` Argon2 + création de session ; chemin « email pris » = un seul `make_password`).
- **Règle enfreinte** : CLAUDE.md §4.2 — « Pas d'énumération d'utilisateurs : connexion, **inscription** et reset renvoient le même message et le même temps de réponse, que le compte existe ou non. »
- **Conséquence** : la liste des emails inscrits sur la plateforme est extractible endpoint par endpoint, à 20 essais / 15 min / IP. Le soin mis à l'égaliser sur `login` et sur `password-reset/request` est annulé par ce troisième chemin. C'est exactement le point 6 de la checklist §8 que la porte de l'étape 1 doit prioriser.
- **Piste** : faire converger les deux branches sur une seule et même réponse observable, et déplacer l'ouverture de session hors de la réponse d'inscription.

### 2. Le garde CI « Aucune route prérendue en statique » laisse passer la première ligne du tableau — celle de `/`

- **Emplacement** : `.github/workflows/ci.yml:129`.
- **Constat** : le correctif remplace `grep -qE "^○|\(Static\)"` par `grep -E "^[├└] ○" | grep -qvE "/icon\.svg"`. La logique du second `grep -qv` est correcte (sortie 0 seulement s'il reste une ligne autre que `/icon.svg`, sortie 1 si le premier grep ne produit rien), et l'exclusion de `/icon.svg` est légitime — c'est un asset de métadonnées, pas du HTML porteur de `<script>`. Mais la classe de caractères `[├└]` omet `┌`. J'ai exécuté `npm run build` : Next préfixe la **première** ligne de route par `┌`, les intermédiaires par `├`, la dernière par `└`. Or les routes sont triées et `/` est toujours la première :
  ```
  ┌ ƒ /                                      149 B         103 kB
  ├ ƒ /_not-found                            995 B         104 kB
  ```
  Si `/` redevenait statique, la ligne serait `┌ ○ /` et le garde ne la verrait pas.
- **Règle enfreinte** : CLAUDE.md §8 (une porte doit réellement attraper la régression qu'elle prétend attraper) ; la régression visée est celle documentée dans `progress.md` §Étape 0 point 2, qui portait précisément sur `/`.
- **Conséquence** : le garde est faux-négatif sur la seule route pour laquelle il a déjà échoué une fois en production. À l'étape 2, la landing `/` est justement la page qu'on aura tout intérêt à prérendre pour le SEO — c'est le moment exact où le garde devait parler, et il se taira.
- **Piste** : la classe de caractères doit couvrir les trois préfixes d'arbre que Next émet.

### 3. Le texte `--muted` sur `--paper` ne tient pas le contraste AA

- **Emplacement** : `web/app/(auth)/inscription/page.tsx:14-16` ; `web/app/(auth)/mot-de-passe-oublie/page.tsx:14-16` ; `web/components/auth/FormulaireInscription.tsx:81-83` ; `web/components/auth/FormulaireNouveauMotDePasse.tsx:70-72` ; `web/app/(student)/app/page.tsx:23-25` ; `web/app/(admin)/admin/page.tsx:23-25`.
- **Constat** : ces paragraphes utilisent `text-muted` (`#6e7b78`, `styles/tokens.css:10`) sur `--paper` (`#fafaf7`, `styles/tokens.css:6`), aux tailles `--texte-base` (16 px) et `--texte-sm` (15 px). Rapport de contraste calculé : **4,36:1**. Le seuil AA pour du texte normal est 4,5:1. Il ne s'agit pas de métadonnées décoratives : « Au moins 10 caractères, pas un mot de passe courant. » est une consigne de saisie, et « Le premier chapitre est accessible tout de suite, sans paiement. » est un argument de vente.
- **Règle enfreinte** : CLAUDE.md §6 — « Plancher de qualité, **non négociable** : […] contraste AA ».
- **Conséquence** : sur un téléphone Android en plein soleil, cible explicite du §6, ces phrases deviennent illisibles. Le défaut est dans le token, donc il se propagera mécaniquement à tous les écrans des étapes 2 à 8 si on ne le tranche pas maintenant.
- **Piste** : soit `--muted` est réservé aux bordures et au texte ≥ 18,66 px gras, soit sa valeur est assombrie ; dans les deux cas la décision appartient au §6 et demande un accord explicite.

---

## MAJEUR

### 1. L'inscription contourne la limite de 5 tentatives / 15 min / compte

- **Emplacement** : `api/apps/accounts/views.py:60-88` (un seul `enforce_rate_limit("register:ip", …, 20, 900)`) à comparer avec `api/apps/accounts/views.py:102-106` (`login:account` 5/900 **et** `login:ip` 20/900).
- **Constat** : `RegisterView` exécute un `services.connecter()` complet avec les identifiants fournis, mais n'incrémente aucun compteur par compte. Une réponse porteuse de cookies signifie « mot de passe correct ». `POST /api/auth/register` est donc un endpoint de connexion doté d'un quota quatre fois plus large et sans plafond par compte.
- **Règle enfreinte** : CLAUDE.md §4.2 — « Rate limit : 5 tentatives de connexion / 15 min / compte **et** 20 / 15 min / IP ».
- **Conséquence** : le critère de sortie « 6 tentatives de connexion échouées en 15 min renvoient un 429 » de `progress.md` est satisfait sur `/login` et faux sur l'application prise dans son ensemble.
- **Piste** : tout chemin qui vérifie un mot de passe doit passer par le même compteur par compte.

### 2. Aucun code n'appelle jamais `/api/auth/refresh` : la session meurt au bout de 15 minutes

- **Emplacement** : `web/app/api/auth/refresh/route.ts` (route complète) ; `web/lib/current-user.ts:10-22` ; `web/middleware.ts:34-37`.
- **Constat** : `grep -rn "auth/refresh" web/{app,components,lib}` ne renvoie que la route elle-même et ses tests. Le commentaire de `middleware.ts:36-37` annonce « l'appel API qui suit échoue alors en 401 et déclenche un refresh côté client » — ce déclencheur n'existe pas. `utilisateurCourant()` renvoie `null` sur 401 et la page redirige vers `/connexion`. Le cookie `refresh` de 7 jours est posé, stocké, tourné côté Django… et jamais présenté.
- **Règle enfreinte** : CLAUDE.md §7 (code mort) et §2 (« access court + refresh rotatif », dont l'intérêt entier est la durée de vie longue côté utilisateur).
- **Conséquence** : l'étudiant est déconnecté toutes les 15 minutes en pleine leçon. À l'étape 4, une vidéo mise en pause 20 minutes rendra l'utilisateur à l'écran de connexion — soit le contraire du scénario d'intégration de l'étape 4.
- **Piste** : le 401 doit avoir un consommateur unique qui tente la rotation avant de conclure à la déconnexion ; sinon la route et le cookie long n'ont pas de raison d'exister à cette étape.

### 3. `device_fingerprint` vaut la même chose pour tout le monde

- **Emplacement** : `api/apps/accounts/views.py:45-48` ; `web/lib/api.ts:34-44` ; `web/app/api/auth/login/route.ts:22-30`.
- **Constat** : Django lit `HTTP_X_DEVICE_FINGERPRINT` sinon `HTTP_USER_AGENT`. Aucun fichier de `web/` n'émet `X-Device-Fingerprint`, et `apiFetch` ne transmet que `Content-Type` et `X-Forwarded-For` — le `User-Agent` du navigateur n'est jamais relayé. Ce qui est stocké dans `Session.device_fingerprint` est donc l'agent du `fetch` serveur de Next, identique pour tous les comptes et tous les appareils.
- **Règle enfreinte** : CLAUDE.md §5 (le champ `Session.device_fingerprint` est censé porter une information) et §4.1.6 (« >3 empreintes d'appareil distinctes sur 7 jours »).
- **Conséquence** : la colonne est remplie d'une constante. À l'étape 4, le seuil de détection de partage fondé sur les empreintes ne pourra jamais se déclencher, et personne ne le verra puisque le champ n'est pas vide.
- **Piste** : ou bien le BFF transmet une empreinte réelle, ou bien le champ reste vide et le manque est consigné jusqu'à l'étape 4.

### 4. La limite par IP est soit globale, soit contournable, selon le déploiement — et rien ne le dit

- **Emplacement** : `web/lib/client-ip.ts:5-9` ; `api/apps/accounts/utils.py:14-19`.
- **Constat** : `ipDuVisiteur()` renvoie `""` si ni `x-forwarded-for` ni `x-real-ip` ne sont présents, et le BFF envoie alors `X-Forwarded-For: ""`. Côté Django, `if forwarded:` est faux et l'on retombe sur `REMOTE_ADDR`, c'est-à-dire l'adresse du conteneur Next — la même pour tous les visiteurs. Symétriquement, `get_client_ip` fait une confiance totale au premier maillon de `X-Forwarded-For` : si Next est un jour joignable sans reverse-proxy assainissant, l'en-tête est forgeable et la limite par IP disparaît. Le commentaire de `utils.py:3-6` couvre la seconde moitié du problème, pas la première.
- **Règle enfreinte** : CLAUDE.md §4.2 (limite par IP réellement effective) et §4.6 (configuration explicite).
- **Conséquence** : dans un déploiement sans proxy configuré, `login:ip` à 20/15 min devient un plafond **global** : vingt échecs de connexion sur la plateforme entière verrouillent tout le monde. C'est un déni de service que la CI ne verra pas.
- **Piste** : traiter l'absence d'IP exploitable comme un cas explicite, et poser en `.env.example` / `docs/` l'exigence de proxy de confiance.

### 5. `logout` révoque une session par son identifiant sans vérifier le secret

- **Emplacement** : `api/apps/accounts/services.py:183-190` ; `api/apps/accounts/views.py:147-155`.
- **Constat** : `deconnecter()` fait `parse_refresh_cookie_value(...)` puis ignore la partie secret (`session_id, _secret = parsed`) et révoque directement `Session.objects.filter(pk=session_id)`. La vue est `AllowAny`, sans authentification ni limite de débit. Quiconque connaît un identifiant de session peut couper la session correspondante — le secret est là, gratuit à comparer, et n'est pas comparé.
- **Règle enfreinte** : CLAUDE.md §4.3 — « Contrôle au niveau de l'objet sur chaque endpoint qui prend un id ».
- **Conséquence** : impact pratique faible aujourd'hui (UUIDv4 non devinable), mais l'invariant « on ne touche à une ressource qu'en prouvant qu'elle est à soi » est enfreint, et l'identifiant de session est visible dans l'admin Django et sera manipulé par le back-office de l'étape 7.
- **Piste** : la révocation doit exiger la même preuve que la rotation.

### 6. `flagged_for_review` est renvoyé à l'utilisateur signalé

- **Emplacement** : `api/apps/accounts/serializers.py:41-49` (`MeSerializer`) ; `web/lib/auth-schemas.ts:5-13` ; exposé au navigateur par `web/app/api/me/route.ts:34`.
- **Constat** : le drapeau anti-partage du §4.1.6 est sérialisé dans `GET /api/me`, donc lisible en clair dans le navigateur de l'étudiant.
- **Règle enfreinte** : CLAUDE.md §4.1.6 — le signalement « remonte à l'admin », il n'est pas destiné à l'utilisateur ; §4.4 par analogie (les champs internes ne quittent pas le serveur).
- **Conséquence** : à l'étape 4, celui qui revend ses accès saura, au caractère près, quand la détection l'a repéré, et ajustera son comportement avant qu'Anis n'ait ouvert son back-office. La valeur défensive du dispositif est annulée avant même d'être construite.
- **Piste** : ce champ appartient aux serializers admin de l'étape 7, pas à `/api/me`.

### 7. Les formulaires client consomment les réponses JSON sans Zod, en `any` implicite

- **Emplacement** : `web/components/auth/FormulaireInscription.tsx:29-32` ; `web/components/auth/FormulaireNouveauMotDePasse.tsx:33-38`.
- **Constat** : `const corps = await reponse.json().catch(() => ({}))` a le type `any` (signature de `Response.json()` dans lib.dom), et `corps.password` est lu et concaténé dans l'interface sans validation de schéma. Aucun `any` explicite n'apparaît donc `eslint` et `tsc` restent verts, mais la valeur circule bien non typée jusqu'au rendu. Les schémas Zod existent pourtant déjà dans `web/lib/auth-schemas.ts` et ne sont utilisés que côté serveur.
- **Règle enfreinte** : CLAUDE.md §7 — « Zod pour valider toute réponse d'API avant usage — le front ne fait jamais confiance à la forme des données » et « `any` interdit ».
- **Conséquence** : un jour où Django renverra `{"password": {"detail": …}}` au lieu d'une liste, le rendu affichera `[object Object]` au lieu de dire quoi corriger. Le motif est déjà dupliqué deux fois ; il le sera dans chaque formulaire des étapes 3 et 6.
- **Piste** : un schéma d'erreur partagé, validé avant lecture, dans les deux formulaires.

### 8. Inscription avec un email déjà pris : l'utilisateur est renvoyé à `/app` puis éjecté sans un mot

- **Emplacement** : `web/components/auth/FormulaireInscription.tsx:39-45` ; message jamais lu produit par `web/app/api/auth/register/route.ts:50-53`.
- **Constat** : le formulaire teste `!reponse.ok`. Or la réponse « email déjà pris » est un `201` sans cookie : `reponse.ok` est vrai, donc `router.push("/app")`. Le middleware ne trouve pas de cookie de session et redirige vers `/connexion`. Le `detail` rédigé exprès pour ce cas n'est jamais affiché.
- **Règle enfreinte** : CLAUDE.md §6 — « Un bouton dit ce qu'il fait […] et le message de succès reprend le même verbe. Les erreurs disent quoi corriger. » ; §8 (gestion des cas limites).
- **Conséquence** : le cas le plus banal du formulaire d'inscription — se réinscrire alors qu'on a déjà un compte — se solde par un aller-retour muet vers la page de connexion. L'utilisateur croit à un bug.
- **Piste** : distinguer les deux formes de `201` côté client et afficher le message déjà écrit.

### 9. Les deux emails partent en `fail_silently=True`

- **Emplacement** : `api/apps/accounts/emails.py:20` et `api/apps/accounts/emails.py:35`.
- **Constat** : une panne SMTP est avalée sans exception ni journalisation. `demander_reinitialisation()` renvoie normalement, l'API répond « un lien vient d'être envoyé », et personne — ni l'utilisateur, ni Anis — n'apprend que rien n'est parti.
- **Règle enfreinte** : CLAUDE.md §7 (gestion d'erreurs, cas limite « l'appel externe échoue »).
- **Conséquence** : un incident SMTP rend la réinitialisation de mot de passe silencieusement inopérante pour toute la promo. Le seul symptôme sera un afflux de messages « je n'ai rien reçu ».
- **Piste** : l'échec d'envoi doit laisser une trace côté serveur, sans jamais journaliser le lien ni le jeton (§4.6).

---

## MINEUR

1. **Index inutile, index manquant.** `api/apps/accounts/models.py:85` indexe `(user, used_at)` sur `PasswordResetToken`, mais la seule requête réelle est `filter(token_hash=…)` (`services.py:218-224`), sur une colonne non indexée. Même remarque de moindre portée pour `Session` : l'index `(user, revoked_at)` sert bien `deconnecter_partout`, celui-là est correct.
2. **Le compteur de connexion décompte aussi les réussites.** `api/apps/accounts/views.py:103` incrémente avant vérification et `throttling.py:24-33` ne remet jamais à zéro : six connexions **réussies** en 15 minutes verrouillent le compte. Corollaire connu : cinq échecs délibérés verrouillent le compte d'un tiers pendant 15 minutes.
3. **Aucune invalidation des jetons de réinitialisation antérieurs.** `services.py:197-208` : jusqu'à trois liens valides simultanément par heure. Assumé par `tests/test_services.py`, mais §4.2 (« usage unique ») se lit plus naturellement comme « un seul lien vivant ».
4. **Effet de bord dans la transaction.** `services.py:107` envoie l'email de bienvenue à l'intérieur du `@transaction.atomic` : l'email peut partir alors que la transaction sera annulée ensuite.
5. **`assert isinstance(request.user, User)`** en `views.py:164` et `views.py:219` : les `assert` disparaissent sous `python -O`. Ce sont des affirmations de typage, pas des gardes, mais autant ne pas laisser un contrôle de sécurité apparent reposer dessus.
6. **`effacerCookiesAuth`** (`web/lib/auth-cookies.ts:40-43`) réécrit les cookies sans `httpOnly`/`secure`/`sameSite`, contrairement à `poserCookiesAuth`. La suppression fonctionne (l'appariement se fait sur nom + chemin), mais l'asymétrie invite à l'erreur.
7. **Duplication du nom de cookie Django.** La chaîne littérale `access_token=` est écrite dans `web/lib/current-user.ts:16`, `web/app/api/me/route.ts:18` et `web/app/api/auth/logout-all/route.ts:17`, en regard de `api/apps/accounts/authentication.py:21`. Quatre endroits, aucune constante partagée ; et `web/lib/current-user.ts:14-22` duplique presque mot pour mot `web/app/api/me/route.ts:16-32`.
8. **CI : second `npm run build`.** `.github/workflows/ci.yml:129` reconstruit tout alors que l'étape `build` (ligne 116) vient de le faire — quelques minutes de CI pour rien. Accessoirement, le `run` par défaut de GitHub Actions n'active pas `pipefail` : l'échec du `npm run build` de cette ligne serait masqué par le statut du `grep`.
9. **`password-reset/request` ment quand Django est injoignable.** `web/app/api/auth/password-reset/request/route.ts:20-27` ignore le résultat de `apiFetch` et répond toujours « un lien vient d'être envoyé ». L'indifférenciation est voulue (§4.2) ; l'indifférence à une panne totale ne l'est pas.
10. **Pas de message de succès.** « Créer mon compte » (`FormulaireInscription.tsx:96`) et « Changer le mot de passe » (`FormulaireNouveauMotDePasse.tsx:79`) redirigent sans rien confirmer, là où « Envoyer le lien » → « un lien de réinitialisation vient d'être envoyé » applique correctement la règle du §6. À reprendre pour la cohérence du verbe.
11. **Navigation interne en `<a href>`** plutôt qu'en `<Link>` : `app/(auth)/connexion/page.tsx:21`, `app/(auth)/inscription/page.tsx:21`, `components/auth/FormulaireConnexion.tsx:80-85`. Rechargement complet du document à chaque fois, sur une audience en connexion moyenne (§6).
12. **`Enrollment` sans contrainte d'unicité ni index** (`api/apps/enrollment/models.py:10-33`). `Course` n'existe pas encore, donc rien n'est cassé ; à ne pas oublier à l'étape 2, sous peine de doublons d'inscription indétectables.
13. **Focus visible partiel.** `ChampTexte.tsx:37` traite bien le cas des champs ; les boutons et liens (`FormulaireConnexion.tsx:72-85`, etc.) s'en remettent au contour par défaut du navigateur, peu lisible sur `bg-zellige`. §6 exige un focus visible « partout ».
14. **Couverture web en recul.** `npm run test:cov` donne 88,58 % d'instructions contre 100 % à l'étape 0, avec `app/(auth)/**/page.tsx` et `app/(student)/app/page.tsx` à 0 %. Constat transmis à l'agent 2, à qui revient l'arbitrage.

---

## Verdict

**PORTE FERMÉE.**

Le travail est sérieux et l'essentiel du §7 est tenu : services séparés des vues, serializers explicites, transactions atomiques aux bons endroits, migrations cohérentes, `ruff` / `mypy --strict` / `eslint` / `tsc` réellement verts, aucun `TODO` ni code mort laissé traîner — à une exception près, la route de refresh.

Trois points l'empêchent de passer. L'inscription est un oracle d'énumération, ce que le §4.2 interdit nommément pour cet endpoint précis, et le test qui l'entoure grave le défaut dans le marbre. Le garde CI censé protéger la CSP a été corrigé d'un bug pour en introduire un autre, exactement sur la route qui avait cassé à l'étape 0. Et le contraste du texte secondaire est sous le seuil AA que le §6 déclare non négociable, sur un token qui se propagera à tous les écrans suivants.

Deux majeurs méritent une attention particulière parce qu'ils préparent une étape ultérieure à échouer silencieusement : `device_fingerprint` est une constante déguisée en donnée, et `flagged_for_review` prévient le fraudeur qu'il est repéré — deux pièces du dispositif du §4.1 qui seront réputées en place à l'étape 4 alors qu'elles seront inertes.

**Remarques : 3 BLOQUANT · 9 MAJEUR · 14 MINEUR.**

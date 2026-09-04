# Étape 03 — Revue de code

**Date** · 2026-09-04
**Branche relue** · `etape-03-inscription-payante`. Aucun commit d'étape : tout le travail est dans le working tree (diff + untracked). HEAD reste `6ed04eb` (« docs: consigner l'état réel de l'étape 2 dans progress.md »).
**Périmètre** · `api/apps/enrollment/**` (modèles, services, vues, serializers, files/storage/signing/providers, permissions, emails, admin, commande `purger_preuves`, migration `0002`, tests), `api/apps/audit/**` (modèle, services, admin, migration, tests), `api/apps/catalog/{views.py,serializers.py,urls_private.py}` (paywall authentifié), `api/apps/accounts/services.py` (rattachement d'inscription à l'enregistrement), `api/config/{settings/base.py,settings/prod.py,urls.py}`, `api/Dockerfile`, `api/pyproject.toml`, `docker-compose.yml` (service `purge`), `.env.example`, `.gitignore`, `web/app/(student)/app/{page,activation,chapitre}/**`, `web/app/(admin)/admin/{page,inscriptions}/**`, `web/app/api/{enrollment,admin}/**`, `web/components/{enrollment,admin,student,course}/**`, `web/lib/{enrollment,enrollment-schemas,session-headers,api,catalog,catalog-schemas}.ts`, tests web d'enrollment.

## Commandes exécutées et résultat brut

Exécutées via `docker compose exec -T` sur les services `api` et `web` (conteneurs `healthy` au moment de la revue).

| Commande | Résultat |
|---|---|
| `docker compose exec -T api ruff check apps config` | **ÉCHEC** — `apps/enrollment/tests/test_files.py:6` `I001` (bloc d'imports non trié : `Image` importé deux fois). Le code de production (`ruff check` hors `**/tests/**`) est vert. |
| `docker compose exec -T api ruff format --check apps config` | **ÉCHEC** — `Would reformat: apps/enrollment/tests/test_endpoints_etudiant.py` et `apps/enrollment/tests/test_services.py` ; `2 files would be reformatted, 108 files already formatted`. |
| `docker compose exec -T api mypy apps config` | **ÉCHEC** — `apps/enrollment/tests/test_domaine.py:26: error: Statement is unreachable [unreachable]` ; `Found 1 error in 1 file (checked 110 source files)`. |
| `docker compose exec -T api python manage.py makemigrations --check --dry-run` | `No changes detected` |
| `docker compose exec -T web npm run lint` | vert, aucune sortie eslint |
| `docker compose exec -T web npm run typecheck` | vert, `tsc --noEmit` sans erreur |
| `rg "fields = '__all__'"` sur `api/apps` | aucune occurrence (hors commentaires qui l'interdisent) |
| `rg "\bany\b"` sur `web/{app,components,lib}` | aucune occurrence |
| `rg "#[0-9a-fA-F]{3,8}"` sur `web/{app,components,lib}` | uniquement `web/styles/tokens.css` (tokens du §6, hors composants) |
| `rg "TODO\|FIXME\|console\.log"` sur `web/{app,components,lib}` et `api/apps` (hors tests) | aucune occurrence |
| `rg "fetch("` sur les composants client de l'étape | uniquement vers `/api/enrollment/...` et `/api/admin/...` (BFF Next), jamais vers Django |

Le workflow CI (`.github/workflows/ci.yml`) exécute `ruff check .`, `ruff format --check .` et `mypy apps config` : les trois commandes ci-dessus, telles quelles, feraient échouer la CI.

---

## BLOQUANT

### 1. `ruff` et `mypy --strict` sont rouges sur `apps/`

- **Emplacement** : `api/apps/enrollment/tests/test_files.py:6-13` (`I001`, double import `PIL.Image` / `PIL.Image as PILImage`) ; `api/apps/enrollment/tests/test_endpoints_etudiant.py` et `api/apps/enrollment/tests/test_services.py` (format) ; `api/apps/enrollment/tests/test_domaine.py:26` (`Statement is unreachable` après `assert inscription.donne_acces_au_contenu is True`).
- **Constat** : les trois commandes exigées par CLAUDE.md §7 ont été exécutées réellement dans le conteneur `api`. Aucune ne passe. Le code métier (hors tests) est lui ruff-propre ; l'échec est entièrement dans les tests de l'étape, qui vivent sous `apps/` et sont donc dans le périmètre de `mypy apps config` et de la CI (`ruff check .`). `warn_unreachable` de mypy considère la branche `BLOCKED` du test comme morte, parce que le typage de `Enrollment.status` ne suit pas l'affectation `= ACTIVE` : l'assertion `is True` est vue comme toujours fausse.
- **Règle enfreinte** : CLAUDE.md §7 (Django) — « `ruff` + `mypy` en mode strict sur `apps/` » ; et l'étape CI correspondante, qui rejoue exactement ces commandes.
- **Conséquence** : l'étape n'est pas fusionnable. Un `push` casse la CI sur le lint, indépendamment de la qualité du pipeline §4.5. Tolérer un rouge « ce n'est que les tests » installe le même précédent que la dérive modèle/migration de l'étape 2.
- **Piste** : faire passer `ruff check`, `ruff format` et `mypy apps config` au vert sur l'arbre actuel, y compris les tests.

---

## MAJEUR

### 2. L'admin Django peut activer une inscription et supprimer une preuve hors du pipeline

- **Emplacement** : `api/apps/enrollment/admin.py:17-22` (`EnrollmentAdmin.readonly_fields` omet `status` ; pas de `has_add_permission` / `has_change_permission` / `has_delete_permission`) ; `api/apps/enrollment/admin.py:25-49` (`PaymentProofAdmin` interdit ajout et modification, **pas** la suppression) ; le test `api/apps/enrollment/tests/test_domaine.py:59-67` vérifie `has_add` et `has_change` sur la preuve, et s'arrête là.
- **Constat** : depuis l'admin Django, un compte `is_staff` peut passer `Enrollment.status` à `ACTIVE` (ou `BLOCKED`) sans `accepter_inscription` : pas de transaction avec la preuve, pas de `purge_after`, pas d'`AuditLog`, pas d'email. Il peut aussi créer une inscription déjà active, et **supprimer** une `PaymentProof` (le fichier chiffré reste sur disque ; `purged_at` n'est jamais posé). `AuditLogAdmin` est correctement verrouillé (`has_delete_permission = False`) ; l'inscription et la preuve, qui sont précisément l'objet de l'étape, ne le sont pas.
- **Règle enfreinte** : CLAUDE.md §7 — « Toute transition d'état (validation de paiement, …) est dans une transaction atomique » et « Logique métier dans `apps/<app>/services.py`, pas dans les vues » ; CLAUDE.md §4.6 — `AuditLog` pour toute action admin de validation de paiement ; CLAUDE.md §4.5 — purge à 90 jours, pas destruction ad hoc depuis l'interface.
- **Conséquence** : le filet de sécurité du §2 (`l'admin Django sert aux tâches rares`) devient un second chemin d'activation, invisible pour l'étudiant et pour le journal. Une preuve « disparue » de la base laisse un fichier CCP chiffré orphelin, hors de la commande de purge (qui filtre sur `purged_at__isnull=True` **et** une ligne encore présente).
- **Piste** : aligner `EnrollmentAdmin` / `PaymentProofAdmin` sur `AuditLogAdmin` pour tout ce qui est transition d'état, et ne laisser le filet de sécurité que sur des champs non décisionnels (`note_admin`).

### 3. Le plafond de 5 Mo n'est pas un plafond de serveur

- **Emplacement** : `api/apps/enrollment/views.py:67-74` (le 413 précoce lit `request.META["CONTENT_LENGTH"]`) ; `api/config/settings/base.py:152-157` (`DATA_UPLOAD_MAX_MEMORY_SIZE` / `FILE_UPLOAD_MAX_MEMORY_SIZE` ne font que basculer vers un fichier temporaire, ils ne bornent pas la taille de la requête) ; `web/app/api/enrollment/proof/route.ts:25-30` (même confiance dans `content-length`) ; `docker-compose.yml` (aucun reverse-proxy, donc aucun `client_max_body_size`).
- **Constat** : `CONTENT_LENGTH` est fourni par le client. Un corps de 100 Mo avec un en-tête absent ou sous-déclaré n'est refusé qu'**après** que WSGI / `request.formData()` l'ait déjà lu. Le pipeline §4.5 (`assainir_preuve`, `fichier.size` côté BFF) rejette ensuite correctement le fichier — rien n'est stocké — mais le coût (disque, RAM, worker bloqué) est déjà payé. `progress.md` exige qu'un fichier de 100 Mo soit rejeté ; tel quel, le rejet n'est pas un refus d'admission.
- **Règle enfreinte** : CLAUDE.md §4.5 — « Taille max 5 Mo » ; critère « terminé quand » de l'étape 3 (« un fichier de 100 Mo [est] rejeté »).
- **Conséquence** : en développement, et en production tant qu'aucun proxy ne borne le corps, l'endpoint de dépôt est un vecteur de déni de service bon marché. Le 413 affiché dans les tests honnêtes (en-tête correct) ne prouve pas le cas hostile.
- **Piste** : borner la taille **avant** parsing complet (réglage serveur / proxy, ou lecture plafonnée du flux), pas seulement d'après un en-tête client.

### 4. L'upload de preuve hérite du timeout JSON de 8 s

- **Emplacement** : `web/lib/api.ts:23` (`TIMEOUT_MS = 8_000`) ; consommé par `web/app/api/enrollment/proof/route.ts:58-68` (`apiFetch` du multipart vers Django) et par `web/app/api/admin/proofs/[id]/apercu/route.ts:64` (`apiFetchBinaire`).
- **Constat** : `apiFetch` a été étendu dans cette étape pour accepter `FormData`, mais le délai n'a pas bougé. Django, lui, réencode jusqu'à `PIXELS_MAX = 50_000_000` pixels (`api/apps/enrollment/files.py:33, 86-89`) : une capture de 5 Mo / ~8 000 px de côté peut occuper le worker plus de 8 s. Le BFF abandonne, renvoie 503 « Service indisponible. » (`proof/route.ts:70-71`), alors que `deposer_preuve` peut quand même commiter. L'étudiant retente et reçoit 409 « Ton reçu est déjà en cours de vérification. »
- **Règle enfreinte** : CLAUDE.md §7 — gestion d'erreurs et cas limites ; CLAUDE.md §6 — l'erreur doit dire quoi corriger, pas un mensonge de disponibilité ; le parcours d'intégration de l'étape 3 (dépôt → file admin) casse sur le chemin nominal d'une photo un peu lourde, audience « connexion moyenne » du §6.
- **Conséquence** : le happy path de l'étape n'est fiable que pour des JPEG légers. Une capture de reçu prise depuis l'appareil photo (cas réel) peut à la fois réussir côté serveur et échouer côté étudiant.
- **Piste** : un timeout d'upload distinct, calé sur le travail Pillow réel, et un message d'erreur qui ne parle pas d'indisponibilité quand Django a déjà accepté le reçu.

### 5. L'URL signée de la preuve transite en query string, donc dans les journaux d'accès

- **Emplacement** : `api/apps/enrollment/services.py:283-286` (`path=f"/api/admin/proofs/{preuve.pk}/file?expires={expires}&signature={signature}"`) ; `api/apps/enrollment/views.py:200-216` (lecture de `expires` et `signature` depuis `query_params`) ; `api/config/settings/base.py:203-215` (LOGGING standard, aucun filtre d'URI) ; confirmé par le format des logs `runserver` déjà observés sur ce conteneur (`"POST /api/enrollment/proof HTTP/1.1"` — la query string est conservée).
- **Constat** : la signature lie bien `(proof_id, actor_id, expires)` et la vue exige *aussi* une session admin — le mécanisme d'autorisation est solide, et le BFF ne relaie pas l'URL au navigateur (`apercu/route.ts:17-19`). En revanche, le GET Django porte la signature dans l'URI. `django.server` / gunicorn journalisent la ligne de requête complète. `journaliser()` ne met pas la signature dans `metadata` (correct) ; les journaux HTTP, si.
- **Règle enfreinte** : CLAUDE.md §4.6 — « Les journaux ne contiennent jamais : mots de passe, tokens, cookies, **URLs signées**, contenu des preuves de paiement. » Cette étape est celle qui introduit les URLs signées.
- **Conséquence** : une rotation de logs, un scrape Sentry, un copier-coller de terminal, et l'URL de 10 min est rejouable **par le même admin** (elle est liée à `actor_id`). Ce n'est pas un IDOR étudiant, c'est une fuite d'autorisation courte dans un canal que le §4.6 interdit explicitement. À laisser à l'agent 3 pour l'exploitation ; ici c'est déjà une violation de convention.
- **Piste** : faire voyager la signature hors query string (en-tête, corps), ou filtrer les journaux d'accès pour ces routes.

### 6. « CCP » est codé en dur hors de l'adaptateur de paiement

- **Emplacement** : `web/components/enrollment/InstructionsVersement.tsx:21` (`<h2>Verse au CCP</h2>`) alors que `instructions.account_label` est déjà fourni par `ManualCCPProvider` (`api/apps/enrollment/providers.py:48`) et affiché comme terme de la `<dl>` ligne 12 ; `web/app/(student)/app/page.tsx:72` (« verse au CCP puis envoie une photo du reçu »).
- **Constat** : l'interface `PaymentProvider` est en place, les coordonnées viennent bien des settings, le serializer d'instructions est générique. L'écran d'activation et la bannière du tableau de bord, eux, parlent de CCP comme d'une constante de copy. Les mentions marketing déjà présentes à l'étape 2 (`Tarifs.tsx`, `Faq.tsx`) ne sont pas de cette étape ; ces deux-ci si.
- **Règle enfreinte** : CLAUDE.md §2 — « Ne pas coder en dur « CCP » partout. » ; checklist du relecteur — « pas de « CCP » codé en dur hors de l'adaptateur de paiement ».
- **Conséquence** : à l'étape 11 (`ChargilyProvider` derrière la même interface), l'étudiant `PENDING` continuera de lire « Verse au CCP » au-dessus d'instructions éventuellement CIB/EDAHABIA. Le travail d'abstraction des vues/services sera à refaire côté copy et composants.
- **Piste** : dériver le titre et la bannière de `instructions.account_label` / `instructions.provider`, comme le reste du bloc.

### 7. Le garde-fou production de la clé de chiffrement n'accepte que la longueur

- **Emplacement** : `api/config/settings/prod.py:34-38` (`len(PAYMENT_PROOF_ENCRYPTION_KEY) < 32`) ; `.env.example:44` — `PAYMENT_PROOF_ENCRYPTION_KEY=remplace-moi-par-48-octets-aleatoires-en-base64url` (48 caractères, donc **accepte** par `prod.py`) ; `api/apps/enrollment/storage.py:65-69` (même seuil de longueur, puis SHA-256 → Fernet).
- **Constat** : `prod.py` refuse à juste titre une clé absente ou courte, et exige un `PAYMENT_PROOF_STORAGE_DIR` explicite. Il n'exige rien sur le prix ni les coordonnées de versement (`COURSE_PRICE_DZD` défaut `0`, `CCP_ACCOUNT_*` défaut `""` dans `base.py:162-165`, non redéfinis en prod). Surtout, la valeur d'exemple du dépôt passe le seul contrôle qui existe. `storage.py` le dit lui-même : « la longueur minimale n'est qu'un garde-fou contre la valeur d'exemple laissée en place, pas une mesure de robustesse » — et ce garde-fou ne distingue pas l'exemple.
- **Règle enfreinte** : CLAUDE.md §4.5 — chiffrement au repos d'un document qui porte un numéro de CCP ; CLAUDE.md §4.6 — aucun secret dans le dépôt, `SECRET_KEY` depuis l'environnement (même esprit pour la clé de preuves).
- **Conséquence** : un déploiement qui copie `.env.example` « pour démarrer » chiffre toutes les preuves avec un secret public. La longueur 32 a l'air d'un contrôle de production ; elle ne l'est pas. En parallèle, un oubli de `COURSE_PRICE_DZD` affiche « 0 DA » sur `/app/activation`.
- **Piste** : refuser en production les valeurs d'exemple (comme `DJANGO_ADMIN_PATH == "admin"` est déjà refusé), et exiger prix / coordonnées de versement non vides.

---

## MINEUR

### 8. La contrainte d'unicité `(user, course)` est inopérante tant que `course` est NULL

- **Emplacement** : `api/apps/enrollment/models.py:55-59` ; `api/apps/enrollment/services.py:64-73` (contournement applicatif documenté) ; migration `api/apps/enrollment/migrations/0002_preuve_de_paiement.py:47-50`.
- **Constat** : PostgreSQL traite deux `NULL` comme distincts. `creer_inscription_initiale` empêche le doublon en Python (`filter(user=user).first()`), sans `select_for_update` sur une ligne encore inexistante. Tant qu'il n'y a pas exactement une formation publiée, `course` reste nul et la contrainte SQL ne tient rien.
- **Règle enfreinte** : CLAUDE.md §7 — migrations / contraintes cohérentes avec l'invariant « une inscription par compte » décrit dans le service.
- **Conséquence** : une course à l'enregistrement, ou un second appel à `inscription_de` avant le premier `INSERT`, peut créer deux `PENDING` pour le même user. Faible en promo 1 (une formation seedée), coûteux le jour où le catalogue en contient 0 ou 2.
- **Piste** : une contrainte d'unicité partielle sur `user` où `course IS NULL`, en plus de `(user, course)`.

### 9. Les emails transactionnels de l'étape sont envoyés `fail_silently=True`

- **Emplacement** : `api/apps/enrollment/emails.py:21`.
- **Constat** : c'est le même geste que `apps/accounts/emails.py` (étape 1). Un échec SMTP (ou console) est avalé ; `accepter_inscription` / `refuser_preuve` / `deposer_preuve` ont déjà commité. Les trois emails sont un livrable explicite de l'étape 3 (`progress.md`).
- **Règle enfreinte** : CLAUDE.md §7 — cas limite « l'appel externe échoue » ; livrable « Emails transactionnels : preuve reçue, compte activé, preuve refusée ».
- **Conséquence** : l'admin valide, l'étudiant n'est jamais prévenu, personne n'a d'erreur. L'étape 9 devra de toute façon une file ; d'ici là le silence est un trou dans le parcours d'intégration.
- **Piste** : journaliser l'échec d'envoi (sans contenu de preuve), plutôt que `fail_silently=True`.

### 10. Nœuds verrouillés à `opacity-45` : tension non arbitrée avec le plancher AA

- **Emplacement** : `web/components/student/ParcoursEtudiant.tsx:56` (`opacity-45` sur l'état `verrouille`).
- **Constat** : le §6 prescrit bien 45 % pour « recommandé plus tard » **et** le contraste AA dans la même section. `text-muted` a disparu des écrans de cette étape (tout le copy est en `text-ink`, c'est un vrai progrès par rapport aux étapes 1-2). Reste le mélange `opacity-45` + `text-ink` sur les chapitres payants d'un compte `PENDING`, soit ~2,9:1. Même tension déjà notée à l'étape 2 sur le parcours marketing, jamais arbitrée par écrit.
- **Règle enfreinte** : CLAUDE.md §6 — « Plancher de qualité, non négociable : […] contraste AA ».
- **Conséquence** : le tableau de bord `PENDING` — écran principal de l'étape — rend illisibles les titres des chapitres que l'étudiant est censé voir pour comprendre ce qu'il achète.
- **Piste** : un arbitrage écrit (token, motif, ou opacité plus haute sur le texte seulement), plutôt que de recopier 45 % sur le titre.

### 11. La constante 5 Mo est recopiée trois fois

- **Emplacement** : `api/apps/enrollment/files.py:32` (source de vérité) ; `web/app/api/enrollment/proof/route.ts:15` ; `web/components/enrollment/FormulaireRecu.tsx:6`.
- **Constat** : Django est bien le seul à décider (§4.5). Le BFF et le client recopie le seuil pour un refus précoce. Rien ne les relie. Un futur « 8 Mo » Django laisserait le BFF à 5 Mo, ou l'inverse.
- **Règle enfreinte** : checklist du relecteur — duplication de logique.
- **Conséquence** : dérive silencieuse du message d'erreur « 5 Mo » par rapport à ce que le serveur accepte vraiment.
- **Piste** : une seule constante côté API, le BFF/le client s'alignant sur la réponse 413 plutôt que sur un littéral jumeau.

---

## Verdict

**PORTE FERMÉE** — un BLOQUANT : `ruff check`, `ruff format --check` et `mypy apps config` sont réellement rouges, et c'est exactement ce que la CI rejouera. Le code de production de l'étape est par ailleurs sérieux (pipeline magic bytes + Pillow + Fernet, URLs signées jamais exposées au navigateur, paywall `ACTIVE`/`is_free` en 404 identique, serializers explicites, Zod sur les BFF, `"use client"` limité aux formulaires, pas de `any`, pas de hex dans les composants, migrations à jour). Ça ne rend pas le lint vert, et les MAJEUR 2–7 (admin Django hors pipeline, plafond 5 Mo contournable, timeout 8 s, signature dans les logs, CCP hors adaptateur, clé d'exemple acceptée en prod) suffiraient à eux seuls à empêcher de considérer l'étape livrable même après un `ruff --fix`.

**Décompte** · BLOQUANT 1 · MAJEUR 6 · MINEUR 4

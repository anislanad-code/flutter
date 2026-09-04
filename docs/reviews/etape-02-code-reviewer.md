# Étape 02 — Revue de code

**Date** · 2026-09-04
**Branche relue** · `etape-02-landing-chapitre-gratuit`, commit `3278688` (« feat: étape 2 — landing publique et chapitre gratuit »), diff `main...etape-02-landing-chapitre-gratuit` : 50 fichiers, +2632 / −399.
**Périmètre** · `api/apps/catalog/**` (modèles, serializers, vues, services, seed, admin, migration, tests), `api/config/urls.py`, `api/tests/test_urls.py`, `web/app/(marketing)/page.tsx`, `web/app/gratuit/[chapitre]/page.tsx`, `web/app/api/public/leads/route.ts`, `web/app/{sitemap,robots}.ts`, `web/app/layout.tsx`, `web/components/marketing/**`, `web/lib/{catalog,catalog-schemas,markdown-leger,env-public,api}.ts`, `web/tests/**`, `.github/workflows/ci.yml`. Suppression de `web/lib/design-tokens.ts` et de ses tests — vérifiée sans référence pendante (`rg design-tokens` ne renvoie plus que des mentions dans les rapports d'étapes précédentes).

## Commandes exécutées et résultat brut

| Commande | Résultat |
|---|---|
| `ruff check .` (api) | `All checks passed!` |
| `ruff format --check .` (api) | `82 files already formatted` |
| `mypy --strict apps` (api) | `Success: no issues found in 68 source files` |
| `manage.py makemigrations --check --dry-run` | **ÉCHEC** — `Migrations for 'catalog': apps/catalog/migrations/0002_alter_lesson_video_provider_id.py ~ Alter field video_provider_id on lesson` |
| `pytest --cov=apps --cov=config` (base SQLite locale, Postgres inaccessible dans l'environnement de revue) | `2 failed, 198 passed` — les deux échecs sont `tests/test_entrypoints.py::test_les_entrypoints_ne_codent_aucun_reglage_en_dur` et `tests/test_settings_config.py::test_la_base_de_donnees_est_postgresql`, tous deux causés par ma propre surcharge de settings, **pas par le code de l'étape**. Couverture 100 % sur `apps/catalog/*`. |
| `npx tsc --noEmit` (web) | aucune sortie, aucune erreur |
| `npx eslint .` (web) | aucune sortie, aucune erreur — 0 `any` |
| `npm test` (vitest) | `Test Files 21 passed (21) · Tests 227 passed (227)` |
| `rg "TODO\|FIXME\|XXX\|console\.log\|debugger"` sur `web/{app,components,lib}` et `api/apps` | aucune occurrence |
| `rg "#[0-9a-fA-F]{3,8}"` sur `web/{app,components,lib}` | 3 occurrences, toutes dans `web/app/icon.svg` (route de métadonnées de l'étape 0, hors périmètre et hors composant) |
| `rg "fields = '__all__'"` sur `api/apps` | aucune occurrence |

Deux contrôles annoncés par `progress.md` n'ont **pas** été rejoués ici et restent à la charge des agents 2 et 3 : Lighthouse mobile (≥ 90 perf/a11y) et le passage `next build` + `next start` que la leçon de l'étape 0 rend obligatoire à chaque étape.

---

## BLOQUANT

### 1. Le lecteur du chapitre gratuit fabrique une URL de fichier MP4 servie en propre

- **Emplacement** : `web/components/marketing/LecteurChapitreGratuit.tsx:15`, consommé par `web/components/marketing/LecteurVideo.tsx:33-42`.
- **Constat** : le composant construit `src={`/videos/${chapitre.lesson.video_provider_id}.mp4`}` et le pose tel quel sur un `<video src>`. Le champ `video_provider_id` est, d'après `api/apps/catalog/models.py:75-79`, un **identifiant Bunny Stream** ; il est sérialisé vers le client par `api/apps/catalog/serializers.py:44`, puis transformé en chemin de fichier local. Aucun répertoire `web/public` n'existe et aucune route `/videos/*` n'est déclarée (`next.config.ts` n'a ni `rewrites` ni `redirects`) : le chemin est mort. Il n'est masqué aujourd'hui que parce que le seed laisse `video_provider_id = ""` (`seed_course.py:119`) et que le composant retombe alors sur le bloc de repli.
- **Règle enfreinte** : CLAUDE.md §2, ligne « Vidéo » — « **Bunny Stream** (token-authenticated). Jamais de MP4 servi par Django ou stocké en public » ; CLAUDE.md §4.1.1 — « Aucune URL de fichier vidéo ne transite jamais vers le client ».
- **Conséquence** : le jour où quelqu'un renseigne `video_provider_id` — c'est précisément ce que fait l'étape 4 — la landing publie une URL de fichier vidéo directement rejouable dans le HTML rendu côté serveur, sur la page la plus indexée du site. Le chemin de sortie choisi ici est architecturalement celui que le §2 interdit, et il faudra le défaire entièrement à l'étape 4 plutôt que de le durcir. Accessoirement, le critère `progress.md` « Le chapitre gratuit est jouable sans compte » n'est pas rempli : rien ne joue, on lit un transcript.
- **Piste** : le chapitre gratuit doit passer par le même chemin d'obtention d'URL que le contenu payant (endpoint serveur qui rend une URL signée), même quand le contrôle de droits est trivialement vrai.

### 2. Le modèle et la migration ont divergé : l'étape CI `makemigrations --check` est rouge

- **Emplacement** : `api/apps/catalog/models.py:78` (`help_text="Identifiant Bunny Stream. Vide tant que la vidéo n'est pas déposée (étape 4)."`) contre `api/apps/catalog/migrations/0001_initial.py:98` (`help_text="Identifiant Bunny Stream. Vide tant que la vidéo n'est pas déposée (§4.1, étape 4)."`).
- **Constat** : le `help_text` a été modifié après génération de la migration. `manage.py makemigrations --check --dry-run` réclame un `0002_alter_lesson_video_provider_id`.
- **Règle enfreinte** : CLAUDE.md §7 (Django) — « Migrations relues avant application » ; et l'étape « Migrations à jour » du workflow, `.github/workflows/ci.yml:68`, qui exécute exactement cette commande.
- **Conséquence** : la CI de l'étape échoue au premier push sur cette étape précise. Le §8 exige de sortir l'étape sur du vert ; par ailleurs, tolérer une dérive modèle/migration sur un champ cosmétique installe l'habitude qui, sur `PaymentProof` à l'étape 3, deviendra une perte de données silencieuse.
- **Piste** : générer et relire la migration manquante, ou ramener le `help_text` du modèle à l'état gelé dans `0001_initial`.

### 3. Le contraste AA du texte secondaire, explicitement renvoyé à cette étape, n'a pas été traité — et il a été multiplié

- **Emplacement** : 14 usages de `text-muted` sur du texte de contenu : `web/app/(marketing)/page.tsx:71,79,93,114,123,132` ; `web/components/marketing/Tarifs.tsx:14,22,30,39` ; `web/components/marketing/Faq.tsx:41` ; `web/components/marketing/Parcours.tsx:22` ; `web/app/gratuit/[chapitre]/page.tsx:42,63`.
- **Constat** : `--muted` (`#6E7B78`, `styles/tokens.css:10`) sur `--paper` (`#FAFAF7`) donne un rapport de contraste de **4,17:1**, sous le seuil AA de 4,5:1 pour du texte normal. Plusieurs de ces occurrences sont à `--texte-sm` (15 px) ou `--texte-xs`, donc loin du régime « large text ». `docs/reviews/etape-01-code-reviewer.md:48` avait constaté le même défaut, l'avait résolu sur les écrans d'authentification en passant à `text-ink`, et avait écrit noir sur blanc : « les seules occurrences restantes sont dans `app/(marketing)/page.tsx` (la page palette de l'étape 0), hors périmètre — **à traiter à l'étape 2, quand cette page deviendra la vraie landing** ». L'étape 2 a réécrit cette page et fait passer le compte de 6 à 14, sur la page qui vend.
- **Règle enfreinte** : CLAUDE.md §6, « Plancher de qualité, **non négociable** : […] contraste AA ». Et `progress.md` étape 2, critère « Lighthouse mobile ≥ 90 perf et a11y ».
- **Conséquence** : la landing entière (description du cours, résumés de modules, réponses de FAQ, mentions de prix, texte du chapitre gratuit) est sous le seuil d'accessibilité, sur un public décrit au §6 comme « majoritairement sur mobile Android, souvent en connexion moyenne » — donc en plein soleil, sur des dalles moyennes. Une régression documentée et datée qui repasse au vert sans avoir été traitée est exactement ce que la porte doit attraper.
- **Piste** : le token `--muted` est figé par le §6 et ne doit pas bouger ; c'est l'usage sur du texte de contenu qui doit être arbitré une fois pour toutes, comme il l'a été à l'étape 1.

*Deux points connexes, qui ne sont pas comptés à part mais relèvent du même plancher* : `border-muted/40` et `divide-muted/40` (`page.tsx:102`, `Faq.tsx:31,35`, `Tarifs.tsx:10`, `Parcours.tsx:27`, `LecteurChapitreGratuit.tsx:50`) descendent encore plus bas que le `border-muted/50` mesuré à 1,90:1 par le MAJEUR 11 de l'étape 1 ; et `Parcours.tsx:44` combine `opacity-45` et `text-ink`, soit environ 2,9:1 sur les titres de chapitres verrouillés (le §6 prescrit bien 45 % pour l'état « recommandé plus tard », mais il prescrit aussi AA dans la même section — cette tension mérite un arbitrage écrit plutôt qu'un silence).

---

## MAJEUR

### 4. Le slug du chapitre gratuit est codé en dur dans la landing : deuxième source de vérité à côté de `is_free`

- **Emplacement** : `web/app/(marketing)/page.tsx:33` — `recupererChapitreGratuit("installer-flutter-et-configurer-ton-editeur")`.
- **Constat** : le héros de la landing sait *par constante littérale* quel chapitre est gratuit, alors que la même page affiche, juste en dessous, un parcours qui dérive cette information de `chapitre.is_free` renvoyé par l'API (`Parcours.tsx:29`). Deux mécanismes calculent la même chose, l'un depuis la base, l'autre depuis le code source. Aucun endpoint ne permet aujourd'hui de demander « le chapitre gratuit de cette formation ».
- **Règle enfreinte** : CLAUDE.md §4.4 — « Cette exception est définie par un flag `is_free` en base, **pas par un id codé en dur** » ; et §1, « le domaine métier est "formation", jamais "formation Flutter" en dur ». La constante `SLUG_FORMATION_PRINCIPALE` (`lib/catalog.ts:16`) est défendable pour une plateforme mono-formation ; le slug de chapitre, non.
- **Conséquence** : si l'admin bascule `is_free` sur un autre chapitre depuis l'admin Django (c'est le seul geste prévu pour ça), le parcours change et le héros ne change pas — il affiche « Le chapitre gratuit est momentanément indisponible » ou continue de servir l'ancien. Le contenu d'appel de la page de vente dépend d'un déploiement de code.
- **Piste** : la structure du cours renvoyée par `/api/public/course/{slug}` contient déjà le drapeau ; le héros peut en dériver le slug sans second appel codé en dur.

### 5. JSON-LD injecté via `dangerouslySetInnerHTML` sans échappement de `</script>`

- **Emplacement** : `web/app/(marketing)/page.tsx:44-59`.
- **Constat** : `JSON.stringify({... name: cours.title, description: cours.description ...})` est écrit dans un `<script type="application/ld+json">`. `JSON.stringify` n'échappe pas la séquence `</script>` : un titre ou une description contenant `</script><script>…` sort du bloc JSON-LD et devient du HTML exécutable. Le commentaire au-dessus affirme que ces valeurs sont « contrôlées par notre back-office, jamais de saisie libre injectée telle quelle » — c'est justement le raisonnement que le §7 interdit, et `Course.title` / `Course.description` sont des champs libres éditables depuis `CourseAdmin` (`api/apps/catalog/admin.py:22-25`).
- **Règle enfreinte** : CLAUDE.md §7 (Next.js) — « Zod pour valider toute réponse d'API avant usage — le front ne fait jamais confiance à la forme des données » ; §4.6 par extension (une CSP à nonce est en place, mais ce `<script>` porte précisément le nonce, ligne 46, donc la CSP ne l'arrêtera pas).
- **Conséquence** : XSS stocké déclenchable par toute écriture dans le titre ou la description d'un cours. La surface est aujourd'hui limitée à l'admin unique, mais elle est sur la page publique la plus visitée et elle survivra à toutes les étapes suivantes. Le préjudice réel se révélera à l'étape 6, où le §8 fait de l'XSS stocké un point de checklist.
- **Piste** : l'échappement de `<`/`>` dans la chaîne sérialisée est le geste standard ; il vaut mieux ici qu'une hypothèse sur la confiance faite au back-office.

### 6. `NEXT_PUBLIC_SITE_URL` a un défaut silencieux `localhost:3000` qui alimente le canonical, l'OG, le sitemap et robots.txt

- **Emplacement** : `web/lib/env-public.ts:16,22` ; consommé par `web/app/layout.tsx:28` (`metadataBase`), `web/app/sitemap.ts:7,11,19`, `web/app/robots.ts:6,12`.
- **Constat** : contrairement à `lib/env.ts` (où `API_INTERNAL_URL` sans valeur fait échouer le démarrage, choix correct), cette variable retombe sur `http://localhost:3000` sans le moindre signal. Le commentaire la qualifie d'« URLs absolues cosmétiques ». Elles ne le sont pas : c'est la base de `alternates.canonical` posé sur les deux pages publiques (`page.tsx:27`, `gratuit/[chapitre]/page.tsx:21`), l'intégralité des `<loc>` du sitemap, et l'URL du sitemap annoncée dans `robots.txt`. `sitemap.ts` et `robots.ts` sont par ailleurs les deux routes que cette étape vient d'ajouter à la liste d'exclusion du garde-fou CI « aucune route prérendue en statique » (`.github/workflows/ci.yml:135`) : elles sont donc figées au build.
- **Règle enfreinte** : `progress.md` étape 2, livrable « Métadonnées SEO, Open Graph, sitemap, données structurées `Course` » ; CLAUDE.md §4.6, « `SECRET_KEY` depuis l'environnement uniquement » — l'esprit est le même : une configuration d'environnement absente doit se voir, pas se deviner.
- **Conséquence** : un build de production qui oublie la variable publie un `sitemap.xml` intégralement rempli d'URLs `http://localhost:3000/...` et des balises canonical qui pointent vers localhost, sur l'entonnoir de vente. Personne ne s'en aperçoit avant de regarder la Search Console des semaines plus tard. Rien dans `web/Dockerfile` ni dans `docker-compose.yml` ne garantit aujourd'hui que la variable est présente au moment du build.
- **Piste** : distinguer le défaut de développement du silence en production, comme le fait déjà `lib/env.ts` pour la variable voisine.

### 7. Le délai anti-bot repose sur un horodatage fourni par le client

- **Emplacement** : `api/apps/catalog/serializers.py:74-76` (`form_rendered_at`, epoch ms envoyé par le navigateur), `api/apps/catalog/services.py:24-26`, posé par `web/components/marketing/FormulaireListeAttente.tsx:12,26`.
- **Constat** : le serveur compare son heure à une valeur que l'appelant choisit librement. Un script qui envoie `form_rendered_at = Date.now() - 10000` passe le contrôle sans attendre. Aucune borne haute non plus : une valeur arbitrairement ancienne est acceptée telle quelle.
- **Règle enfreinte** : `progress.md` étape 2 — « `POST /api/public/leads` […] avec rate limit et **anti-bot (honeypot + délai minimum de soumission)** ». Le honeypot est réel ; le délai ne l'est pas.
- **Conséquence** : sur les deux mécanismes anti-bot exigés, un seul mord vraiment. Reste le rate limit à 5/h/IP — voir le point 8, qui l'affaiblit lui aussi. La table `Lead` est le premier endroit du projet où un anonyme écrit en base.
- **Piste** : un délai plancher n'a de sens que si l'origine du temps est connue du serveur seul.

### 8. Le rate limit de `/api/public/leads` s'appuie sur un `X-Forwarded-For` relayé sans filtrage

- **Emplacement** : `web/app/api/public/leads/route.ts:30` (`headers: { "X-Forwarded-For": ipDuVisiteur(request) }`) → `web/lib/client-ip.ts:6-8` → `api/apps/catalog/views.py:69-73`.
- **Constat** : `ipDuVisiteur` lit l'en-tête `x-forwarded-for` de la requête entrante et prend son premier élément, sans vérifier qu'il provient d'un reverse-proxy de confiance. Le Route Handler le repose ensuite à destination de Django, qui en dérive la clé de comptage. Un client qui envoie son propre `X-Forwarded-For` change de clé à chaque requête. (Le code de `client-ip.ts` date de l'étape 1 et n'est pas dans ce diff ; ce qui est nouveau, c'est qu'un **endpoint d'écriture public non authentifié** en dépend désormais comme unique protection serveur.)
- **Règle enfreinte** : CLAUDE.md §4.2 par analogie (les limites de débit doivent être « réellement effectives ») ; §8 point 6 de la checklist.
- **Conséquence** : combiné au point 7, `POST /api/public/leads` n'a plus de garde-fou effectif contre un remplissage automatisé. La preuve d'exploitation revient à l'agent 3, mais la dépendance mérite d'être documentée ici parce qu'elle est structurelle et qu'elle se répétera sur chaque endpoint public des étapes suivantes.
- **Piste** : la confiance dans `X-Forwarded-For` doit être une décision d'infrastructure explicite (nombre de sauts de proxy connus), pas un défaut implicite du BFF.

### 9. `GET /api/public/course/{slug}` ne renvoie pas les durées annoncées

- **Emplacement** : `api/apps/catalog/serializers.py:19` (`ChapterSummarySerializer.fields`) et `:28` (`ModuleSummarySerializer.fields`).
- **Constat** : `progress.md` décrit l'endpoint comme « structure de la formation : **titres, résumés, durées**. Aucun contenu de leçon. » Le sérialiseur expose `id, slug, order, title, is_free` et rien qui approche `duration_s`, alors que le seed renseigne consciencieusement une durée pour chaque chapitre (`seed_course.py:123,135,146,169`). Le parcours affiché ne peut donc pas indiquer combien de temps dure la formation.
- **Règle enfreinte** : livrable de `progress.md` étape 2, section Backend.
- **Conséquence** : un argument de vente central — « combien de temps ça me prend » — est absent de la page qui vend, et la FAQ (`Faq.tsx:23-26`) est obligée d'y répondre par « ça dépend ». Ajouter le champ plus tard implique de revoir le schéma Zod, le composant `Parcours` et les tests correspondants.
- **Piste** : la durée est une donnée de structure, pas de contenu ; elle ne heurte pas le §4.4.

### 10. Le bloc de repli du lecteur masque son propre texte aux lecteurs d'écran

- **Emplacement** : `web/components/marketing/LecteurVideo.tsx:16-28`.
- **Constat** : le `<div>` porte `role="img"` avec `aria-label="Vidéo de « … » à venir"`. Un élément `role="img"` est présenté comme une image unique : son contenu textuel n'est pas exposé à la technologie d'assistance. Les deux paragraphes à l'intérieur — dont « La vidéo de ce chapitre arrive bientôt. En attendant, lis-le juste en dessous : le contenu est le même. », qui est la seule consigne de navigation de la page — deviennent invisibles.
- **Règle enfreinte** : CLAUDE.md §6, plancher de qualité — « contraste AA, tout l'écran étudiant utilisable au clavier », et l'exigence Lighthouse a11y ≥ 90 de `progress.md`.
- **Conséquence** : c'est aujourd'hui l'**unique** état rendu du héros de la landing, puisque le seed ne pose aucun `video_provider_id`. L'utilisateur de lorikeet entend « Vidéo de Installer Flutter et configurer ton éditeur à venir » et rien d'autre, alors que le chapitre entier est lisible plus bas.
- **Piste** : un état vide informatif n'est pas une image ; il n'a pas besoin d'un rôle qui neutralise son contenu.

---

## MINEUR

### 11. Deux fonctions différentes s'appellent `serverEnv`
- **Emplacement** : `web/lib/env.ts` (export `serverEnv`, `API_INTERNAL_URL`, `server-only`) et `web/lib/env-public.ts:18` (export `serverEnv`, `NEXT_PUBLIC_SITE_URL`). `web/lib/api.ts:3` importe la première, `web/app/layout.tsx:5` la seconde.
- **Constat / conséquence** : deux symboles homonymes au comportement opposé (l'un lance en cas d'absence, l'autre retombe silencieusement). Un import automatique d'éditeur choisira le mauvais sans que `tsc` s'en plaigne, puisque les deux existent. Le nom `serverEnv` pour un fichier `env-public` est en outre contre-intuitif.
- **Piste** : deux rôles distincts méritent deux noms distincts.

### 12. Le message de succès de la liste d'attente ne reprend pas le verbe du bouton
- **Emplacement** : `web/components/marketing/FormulaireListeAttente.tsx:92` (« Rejoindre la liste d'attente ») contre `:47-50` (« Inscrit·e à la liste d'attente. »).
- **Règle enfreinte** : CLAUDE.md §6, Copie — « Un bouton dit ce qu'il fait […] et le message de succès **reprend le même verbe** ».
- **Conséquence** : rupture de la seule règle de copie mesurable du §6, sur le seul formulaire public de l'étape.

### 13. Écriture inclusive à point médian, incohérente avec le reste de la copie
- **Emplacement** : `FormulaireListeAttente.tsx:48` (« Inscrit·e »), `Tarifs.tsx:37` (« Pas encore prêt·e »), `gratuit/[chapitre]/page.tsx:65` (« prévenu·e »).
- **Constat / conséquence** : le §6 demande « français, tutoiement, phrases courtes » et ne mentionne pas le point médian ; le reste du projet (écrans d'authentification de l'étape 1, transcripts du seed) n'en utilise pas. Le point médian est par ailleurs mal restitué par plusieurs lecteurs d'écran. À trancher une fois pour toutes plutôt qu'écran par écran.

### 14. Le même message de succès existe en trois exemplaires, dont deux ne s'affichent jamais
- **Emplacement** : `api/apps/catalog/views.py:88` (`{"detail": "Inscrit à la liste d'attente."}`), `web/app/api/public/leads/route.ts:17` (`MESSAGE_GENERIQUE`), `web/components/marketing/FormulaireListeAttente.tsx:47-50` (texte affiché).
- **Constat / conséquence** : le client ignore le corps de la réponse et affiche sa propre phrase ; les deux autres ne servent qu'à être testées. Le message 429 est dupliqué de la même façon (`views.py:73` / `route.ts:40`). Trois endroits à modifier pour changer une phrase, sans qu'aucun ne soit la source.

### 15. Six symboles exportés de `catalog-schemas.ts` ne sont utilisés nulle part
- **Emplacement** : `web/lib/catalog-schemas.ts` — `chapitreResumeSchema`, `moduleResumeSchema`, `ressourceSchema`, `leconSchema`, et les types `ChapitreResume`, `ModuleResume`. Idem `BlocTranscript` dans `web/lib/markdown-leger.ts:7`.
- **Constat / conséquence** : vérifié par `rg` sur tout `web/` hors `node_modules` et hors fichier de définition : zéro référence, tests compris. Surface publique inutile, que `eslint` ne signale pas pour des exports.

### 16. `recupererCours` et `recupererChapitreGratuit` sont le même code écrit deux fois
- **Emplacement** : `web/lib/catalog.ts:18-28` et `:30-40`.
- **Constat / conséquence** : neuf lignes identiques à deux caractères près (chemin et schéma). La troisième copie arrivera à l'étape 3.

### 17. Un échec de validation Zod est indistinguable d'un 404, et ne laisse aucune trace
- **Emplacement** : `web/lib/catalog.ts:27` et `:39` — `return parsed.success ? parsed.data : null`.
- **Constat / conséquence** : si Django renvoie 200 avec une forme inattendue (renommage d'un champ, régression de sérialiseur), la landing appelle `notFound()` (`page.tsx:38`) et la page de vente devient un 404 sans le moindre journal côté Next. Le comportement de repli est le bon ; c'est l'absence totale de signal qui coûtera une soirée de diagnostic.

### 18. Le rate limit des leads est appliqué après la validation du sérialiseur
- **Emplacement** : `api/apps/catalog/views.py:65-71`.
- **Constat / conséquence** : `serializer.is_valid(raise_exception=True)` court avant `enforce_rate_limit`. Une requête au corps invalide renvoie 400 sans jamais incrémenter le compteur : le quota de 5/h ne s'applique qu'aux requêtes bien formées. Confirmé par `test_email_invalide_est_rejete` (`test_leads_view.py:52`), qui documente le comportement sans le questionner.

### 19. Aucun dédoublonnage sur `Lead.email`, et 5/h/IP est étroit pour le marché visé
- **Emplacement** : `api/apps/catalog/models.py:88-98` (index sur `email`, pas de contrainte d'unicité) ; `api/apps/catalog/views.py:71`.
- **Constat / conséquence** : un visiteur qui soumet deux fois crée deux lignes ; la future campagne d'emailing enverra deux messages. À l'inverse, le §1 décrit un public algérien majoritairement mobile, donc largement derrière du NAT opérateur : cinq inscriptions par heure pour toute une plage partagée est un plafond bas pour une page dont le but est de collecter des emails.

### 20. Infobulle du parcours : mécanisme et libellé hors §6
- **Emplacement** : `web/components/marketing/Parcours.tsx:50` — `title="Réservé aux inscrits actifs"`.
- **Constat / conséquence** : l'attribut `title` n'apparaît ni au clavier ni au toucher — donc jamais sur le mobile Android qui est la cible du §6. Le libellé s'écarte aussi de la forme prescrite (« Passe d'abord l'examen du module 2 » : tutoiement, action à faire). Enfin, l'attribut est posé sur le `<span>` alors que le point visuel du serpentin est `aria-hidden`.

### 21. Le Route Handler des leads impute tous les 400 à l'adresse email
- **Emplacement** : `web/app/api/public/leads/route.ts:22` et `:45`.
- **Constat / conséquence** : « Adresse email invalide. » est renvoyé aussi bien pour un email malformé que pour un `form_rendered_at` absent ou non numérique — cas qui survient réellement si le composant est monté sans horodatage. Le §6 demande que les erreurs disent quoi corriger ; ici elles désignent le mauvais champ. (Ne rien dire sur la cause anti-bot est en revanche volontaire et correct.)

### 22. Le champ honeypot est positionné en absolu sans ancêtre positionné
- **Emplacement** : `web/components/marketing/FormulaireListeAttente.tsx:56-65` (`className="absolute h-0 w-0 opacity-0"`, le `<form>` parent ligne 55 n'a pas de `relative`).
- **Constat / conséquence** : le champ se positionne par rapport au premier ancêtre positionné rencontré, potentiellement très haut dans l'arbre. Avec `h-0 w-0 opacity-0` l'effet visuel est nul aujourd'hui, mais la mise en page du piège ne doit pas dépendre du contexte de son insertion — le même composant est monté à deux endroits différents (`Tarifs.tsx:43` et `gratuit/[chapitre]/page.tsx:76`).

---

## Ce qui est bien fait, et qu'il faut garder

Pour que la fermeture de la porte ne soit pas lue comme un jugement d'ensemble :

- **Le cloisonnement du contenu est correct par construction.** Deux sérialiseurs volontairement disjoints (`serializers.py:14-38` pour l'arbre, `:41-68` pour le chapitre gratuit), et le seul point où une `Lesson` sort de l'API est gardé par `if not chapter.is_free or not chapter.module.course.is_published: raise Http404` (`views.py:52-54`) — 404 et non 403, cours non publié inclus, exactement ce que demandent §4.3 et §4.4. Les trois tests correspondants (`test_chapter_view.py`) vérifient aussi l'absence de fuite dans le corps de la réponse, pas seulement le code de statut.
- **Le rendu du transcript en éléments React** (`lib/markdown-leger.ts` + `LecteurChapitreGratuit.tsx:20-46`) élimine l'XSS par construction plutôt que par assainissement. C'est le bon choix, et il rend d'autant plus regrettable le `dangerouslySetInnerHTML` du JSON-LD juste à côté (MAJEUR 5).
- **Aucun `fetch` navigateur → Django.** `lib/catalog.ts` est marqué `server-only`, le formulaire client passe par `/api/public/leads`, et `apiFetch` reste le point de contact unique. Les Server Components sont bien le défaut : seuls `LecteurVideo` et `FormulaireListeAttente` portent `"use client"`, tous deux dans les catégories autorisées par le §7.
- **Zod est appliqué dans les deux sens** (réponses de Django *et* corps entrant du Route Handler), `fields = '__all__'` est absent, la logique anti-bot est bien dans `services.py` et non dans la vue, et la transaction atomique y est posée.
- **La commande de seed est idempotente et contient du vrai contenu**, pas du lorem ipsum : le transcript du chapitre 1 est un vrai texte pédagogique, avec de vraies commandes.
- **Les modèles sont propres** : `Chapter.slug` unique globalement avec la raison écrite en commentaire, contraintes d'unicité `(course, order)` et `(module, order)`, `is_free` par défaut à `False` — le paywall est fermé par défaut.
- **Les 227 tests front et les 198 tests back passent**, avec 100 % de couverture sur `apps/catalog`.

---

## Verdict

**PORTE FERMÉE.**

Trois motifs, chacun suffisant seul.

Le premier est architectural : le lecteur du chapitre gratuit construit une URL de fichier MP4 servie en propre (BLOQUANT 1), là où le §2 a gelé Bunny Stream en token auth et où le §4.1.1 interdit qu'une URL de fichier vidéo atteigne le client. Le défaut est invisible aujourd'hui parce que le seed ne renseigne aucun identifiant vidéo — c'est-à-dire que le critère « le chapitre gratuit est jouable sans compte » n'est pas rempli non plus. Cette étape pose la première brique du chemin vidéo du projet, et elle la pose du mauvais côté du §2.

Le deuxième est mécanique et se répare en une commande : le modèle et la migration ont divergé, et l'étape CI qui vérifie exactement cela est rouge (BLOQUANT 2). Le §8 demande de sortir l'étape sur du vert.

Le troisième est le plus important pour la crédibilité de la porte elle-même : le contraste AA du texte secondaire (BLOQUANT 3) avait été constaté à l'étape 1, résolu dans son périmètre, et **explicitement renvoyé à l'étape 2 par écrit**. L'étape 2 a réécrit la page concernée et fait passer les occurrences fautives de 6 à 14. Une dette datée et nominativement transmise qui revient plus grosse ne peut pas franchir une porte, sinon les rapports précédents ne valent rien.

Les sept MAJEUR ne ferment pas la porte à eux seuls, mais deux d'entre eux se combinent en une seule faiblesse qu'il faut lire ensemble : le délai anti-bot est falsifiable côté client (7) et le rate limit qui devait le compléter s'appuie sur un en-tête que le client contrôle (8). Le premier endpoint d'écriture publique du projet n'a donc, en pratique, qu'un honeypot. Je laisse à l'agent 3 le soin de leur donner un rang sur son échelle et d'en produire la preuve.

**3 BLOQUANT · 7 MAJEUR · 12 MINEUR.**

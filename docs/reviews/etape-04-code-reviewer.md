# Étape 04 — Revue de code

**Date** · 2026-09-04
**Branche relue** · `etape-04-lecteur-video`. Aucun commit d'étape : tout le travail est dans le working tree (diff + untracked). HEAD reste `09a8aa8` (« feat: étape 3 — inscription payante et validation admin »).
**Périmètre** · `api/apps/media/**` (modèle `PlaybackToken`, `signing`, `services`, vues, serializers, admin, migration `0001`, tests), `api/apps/learning/{models,services,migrations,tests}` (`Progress` + position), `api/apps/accounts/{models.py,migrations/0002_user_concurrent_play_attempts.py}`, `api/apps/audit/{models.py,migrations/0002_alter_auditlog_action.py}`, `api/apps/catalog/serializers.py` (`LessonSerializer` sans `video_provider_id`), `api/config/{settings/base.py,logging_filters.py,urls.py}`, `.env.example`, `web/components/course/{LecteurSecurise,LecteurChapitre}.tsx`, `web/app/api/{lessons/[id]/playback,playback/[id]/heartbeat}/route.ts`, `web/lib/{filigrane,playback-schemas,catalog-schemas,auth-cookie-names}.ts`, `web/middleware.ts` (CSP Bunny + cookie `device`), `hls.js`, tests web playback / filigrane / lecteur.

## Commandes exécutées et résultat brut

Exécutées via `docker compose exec -T` sur les services `api` et `web` (Compose UP au moment de la revue).

| Commande | Résultat |
|---|---|
| `docker compose exec -T api ruff check .` | vert, `All checks passed!` |
| `docker compose exec -T api ruff format --check .` | vert, `137 files already formatted` |
| `docker compose exec -T api mypy apps config` | vert, `Success: no issues found in 127 source files` |
| `docker compose exec -T api python manage.py makemigrations --check --dry-run` | `No changes detected` |
| `docker compose exec -T web npm run lint` | vert, `eslint .` sans sortie |
| `docker compose exec -T web npm run typecheck` | vert, `tsc --noEmit` sans erreur |
| `rg "fields = '__all__'"` sur `api/apps` | aucune occurrence (hors commentaires qui l'interdisent) |
| `rg "\bany\b"` sur `web/{app,components,lib}` | aucune occurrence |
| `rg "#[0-9a-fA-F]{3,8}"` sur `web/{app,components,lib}` | uniquement `web/styles/tokens.css` (tokens du §6, hors composants) |
| `rg "TODO\|FIXME\|console.log"` sur `web/{app,components,lib}` et `api/apps` (hors tests) | aucune occurrence |
| `rg "m3u8\|b-cdn.net"` dans `api/apps/media/{views,serializers}.py` | aucune occurrence |
| `rg "fetch("` sur les composants client de l'étape | uniquement vers `/api/lessons/.../playback` et `/api/playback/.../heartbeat` (BFF Next), jamais vers Django |

Le workflow CI (`.github/workflows/ci.yml`) rejoue exactement `ruff check .`, `ruff format --check .` et `mypy apps config` : contrairement à l'étape 3, ces trois commandes passent.

---

## BLOQUANT

Aucun. `ruff` / `mypy --strict` / `eslint` / `tsc --noEmit` / `makemigrations --check` sont réellement verts. Les serializers listent les champs un par un. La logique d'émission, d'invalidation, de flagage et de signature vit dans `apps/media/services.py` et `apps/media/signing.py`, pas dans les vues. `GET /api/lessons/{id}/playback` et `GET /api/playback/{id}/heartbeat` Django lèvent `Http404()` sans argument. `LessonSerializer` n'expose pas `video_provider_id`. Aucun `any` TypeScript, aucun hexadécimal dans un composant, aucun `TODO`.

---

## MAJEUR

### 1. La session unique n'est pas serialisée : deux POST parallèles laissent deux jetons actifs

- **Emplacement** : `api/apps/media/services.py:114-142` (`_invalider_jetons_actifs` : `filter` + `count` + `update` sans `select_for_update`) ; `api/apps/media/services.py:227-244` (la transaction atomique entoure l'invalidation et le `create`, mais ne pose aucun verrou de ligne sur l'utilisateur).
- **Constat** : deux `POST /api/lessons/{id}/playback` simultanés (deux onglets, un refresh qui chevauche le timer de 4,5 min) voient chacun zéro jeton actif, n'en consomment aucun, et en créent chacun un. Les deux URL signées restent valides jusqu'au TTL. L'incrément de `concurrent_play_attempts` ne se déclenche que si `concurrents > 0` *avant* le `create` du concurrent — la course le laisse à 0. Le test `test_un_second_appareil_invalide_le_premier` est séquentiel, donc vert.
- **Règle enfreinte** : CLAUDE.md §4.1.5 — « un seul token de lecture actif par compte » ; CLAUDE.md §7 — toute transition d'état dans une transaction atomique *avec* un verrou qui tient l'invariant.
- **Conséquence** : l'invariante de session unique, objet même de l'étape, ne tient que si les demandes s'ordonnent. Un partage naïf « deux onglets / deux appareils qui cliquent ensemble » passe entre les mailles, sans flag.
- **Piste** : verrouiller la ligne utilisateur (ou un jeton sentinelle) *avant* de compter et d'invalider, dans la même transaction.

### 2. Un battement en vol pendant le rafraîchissement du jeton affiche « autre appareil »

- **Emplacement** : `web/components/course/LecteurSecurise.tsx:202-228` (un 404 heartbeat → `phase: "autre-appareil"`) ; `web/components/course/LecteurSecurise.tsx:86-116` (`demanderJeton` met `playbackIdRef` à jour seulement *après* la réponse) ; `web/components/course/LecteurSecurise.tsx:192-200` (timer de rafraîchissement 30 s avant expiration, chemin nominal toutes les ~4,5 min) ; dépendance de l'effet heartbeat limitée à `[etat.phase]` (ligne 228), donc l'intervalle survit au changement de jeton.
- **Constat** : le rafraîchissement consomme le jeton A et en émet un B. Si un `POST /heartbeat` parti avec A rentre après cette invalidation, le client traite le 404 comme un second appareil, met en pause, et affiche « Cette leçon est ouverte sur un autre appareil. Relance ici pour reprendre. » Le `.then` ne vérifie pas que `id === playbackIdRef.current`. C'est le scénario d'intégration de `progress.md` (« le token a expiré, le lecteur en redemande un sans interruption visible »).
- **Règle enfreinte** : CLAUDE.md §7 — cas limites ; critère d'intégration de l'étape 4.
- **Conséquence** : une leçon qui dépasse 5 minutes — le cas normal, le TTL est *fait* pour ça — peut s'interrompre avec le message du partage d'écran, alors que c'est le même appareil qui a renouvelé son jeton.
- **Piste** : ignorer un 404 dont le `playback_id` n'est plus le courant, et relancer l'intervalle (ou l'annuler) à chaque nouvel id.

### 3. L'échec de signature Bunny consomme la session précédente puis renvoie 503

- **Emplacement** : `api/apps/media/services.py:227-270` (`transaction.atomic` crée le jeton et invalide les précédents ; `signer_url_lecture` est *ensuite*, hors transaction, et `SignatureImpossibleError` devient `BunnyNonConfigureError` → 503) ; `api/apps/media/tests/test_endpoints.py:126-136` (le test d'échec de signature ne vérifie pas le nombre de jetons restants).
- **Constat** : si l'identifiant vidéo est rejeté par `_identifiant_opaque`, ou si l'hôte CDN est invalide, le client reçoit 503 « Vidéo indisponible. » sans `playback_id`, mais le jeton orphelin est déjà `consumed=False` et les lectures ouvertes du même compte sont déjà coupées. Le cas « clés absentes » est correctement court-circuité *avant* la transaction (`services.py:218-219`) ; ce n'est pas celui-là.
- **Règle enfreinte** : CLAUDE.md §7 — cas limite « l'appel externe échoue » ; CLAUDE.md §4.1.5 — une émission ratée ne devrait pas valoir une invalidation de session.
- **Conséquence** : un `video_provider_id` mal saisi en back-office, ou un hostname CDN temporairement pourri, éjecte l'étudiant de sa lecture en cours et laisse un jeton actif inutilisable jusqu'au TTL.
- **Piste** : ne marquer consommés les anciens jetons, et n'en créer un nouveau, qu'après une signature réussie — ou rollback explicite si la signature lève.

### 4. `enregistrer_position` peut lever `IntegrityError` sur le chemin concurrent

- **Emplacement** : `api/apps/learning/services.py:27-35` (`get_or_create` sur `(user, chapter)` sans `select_for_update` ni rattrapage) ; contrainte `progress_unique_user_chapitre` dans `api/apps/learning/models.py:34-38`.
- **Constat** : deux heartbeats simultanés (deux onglets sur le même chapitre — précisément le cas « second appareil » de l'étape) peuvent tous les deux ne rien trouver et tenter l'`INSERT`. PostgreSQL refuse le second. L'exception n'est ni traduite en 404, ni réessayée : DRF renvoie 500, le BFF (`web/app/api/playback/[id]/heartbeat/route.ts:49-50`) le mappe en 503 « Service indisponible. ».
- **Règle enfreinte** : CLAUDE.md §7 — cas limites et logique métier robuste ; la contrainte unique est posée, le service ne sait pas vivre avec.
- **Conséquence** : le chemin qui *doit* survivre à deux lectures concurrentes (l'une étant invalidée, l'autre écrivant `watched_s`) peut à la place afficher une panne serveur.
- **Piste** : rattraper l'`IntegrityError` et relire la ligne, ou upsert atomique.

### 5. Aucun handler d'erreur HLS : un 403 Bunny laisse le lecteur mort

- **Emplacement** : `web/components/course/LecteurSecurise.tsx:51-84` (`attacherSource` écoute `Hls.Events.MANIFEST_PARSED` uniquement ; pas de `Hls.Events.ERROR`) ; pas d'`error` / `stalled` sur l'élément `<video>` non plus.
- **Constat** : le renouvellement anticipé (30 s avant `expires_at`) couvre le TTL nominal. Il ne couvre pas : changement d'IP (la signature Bunny lie l'IPv4 exacte, `signing.py:66-68`, alors que le heartbeat ne lie que le préfixe /24, `accounts/utils.py:22-30`), 403 CDN, manifeste illisible, réseau coupé puis revenu. `play().catch(() => undefined)` avale aussi le refus d'autoplay. L'étudiant voit une vidéo figée, sans nouvel appel à `/playback`.
- **Règle enfreinte** : CLAUDE.md §7 — cas limites ; CLAUDE.md §4.1.2 — un jeton expiré ou rejeté depuis une autre IP doit mener à une nouvelle émission, pas à un silence.
- **Conséquence** : le critère « un token copié et utilisé depuis une autre IP échoue » est vrai côté Bunny, mais côté produit l'échec est une page morte plutôt qu'un renouvellement.
- **Piste** : sur erreur fatale HLS / média, pause + `demanderJeton(positionRef.current)`, en distinguant un vrai 404 métier.

### 6. Le filigrane survit à la suppression du nœud, pas à l'effacement de son texte

- **Emplacement** : `web/components/course/LecteurSecurise.tsx:147-155` (`MutationObserver` : `childList` + `attributes`, pas `characterData`) ; `web/lib/filigrane.ts:23-55` (`filigraneEstVisible` ne lit ni `textContent` ni le libellé attendu).
- **Constat** : retirer le `div[data-filigrane]` est bien détecté (test `lecteur-securise.test.tsx:91-102`). Vider le texte, le remplacer par des espaces, ou le passer en `color` proche du fond vidéo (seul `transparent` / `rgba(0,0,0,0)` est rejeté, `filigrane.ts:36`) laisse un nœud « visible » pour les observateurs. `style-src 'unsafe-inline'` — reporté dès l'étape 0 comme le moyen de masquer le filigrane sans toucher au DOM — est partiellement traité via `getComputedStyle` (opacité, `display`, `clip-path`, `filter`), pas via le contenu identifiant.
- **Règle enfreinte** : CLAUDE.md §4.1.4 — la superposition doit *contenir* `nom + 4 derniers chiffres + horodatage` ; un nœud vide ne satisfait que la lettre « le DOM est encore là ».
- **Conséquence** : une capture d'écran « nettoyée » en une ligne de DevTools (vider le nœud, ou `color: #14201E`) sort sans identifiant, sans pause, sans nouvelle émission. À laisser à l'agent 3 pour l'exploitation ; ici c'est déjà un trou dans le contrat du filigrane.
- **Piste** : observer `characterData`, exiger que le texte calculé contienne encore le libellé serveur, et traiter une couleur trop proche du fond comme un masquage.

### 7. Le lecteur redemande un jeton toutes les 4,5 min avec un access token qui meurt à 15 min, sans refresh

- **Emplacement** : `web/components/course/LecteurSecurise.tsx:192-200` (renouvellement) ; `web/app/api/lessons/[id]/playback/route.ts:37-48` (le BFF forward le cookie d'accès, ne tente pas `/api/auth/refresh`) ; `web/app/api/lessons/[id]/playback/route.ts:60-62` (tout statut hors 200/429/503, **y compris 401**, devient 404 « Non trouvé. ») ; `web/components/course/LecteurSecurise.tsx:90-92` (404 → « Cette leçon n'est pas disponible. »).
- **Constat** : l'étape 1 a reporté le refresh silencieux à l'étape 5. L'étape 4, elle, *dépend* d'appels authentifiés répétés : un jeton playback vit 5 min, l'access 15 min. À la 4ᵉ émission (~18 min), ou après « pause 10 min » trop tard dans la session, Django voit un anonyme ; une leçon payante → 404 identique à une leçon inexistante. Le BFF aplatit le 401 en 404, le lecteur ne propose pas de se reconnecter.
- **Règle enfreinte** : CLAUDE.md §7 — cas limites du chemin nominal d'une leçon plus longue que l'access ; critère d'intégration « pause 10 min puis reprendre ».
- **Conséquence** : une leçon de 16 minutes sur un compte `ACTIVE` s'arrête sur un mensonge (« n'est pas disponible ») alors que le droit est toujours là, seul le cookie court est mort. Le report étape 1 → 5 n'est plus tenable maintenant que le lecteur existe.
- **Piste** : un refresh de session dans le BFF playback (ou avant), et un 401 distinct d'un 404 leçon, pour que le lecteur sache quoi dire.

---

## MINEUR

### 8. Le GET playback côté BFF Next répond 405, pas 404

- **Emplacement** : `web/app/api/lessons/[id]/playback/route.ts` (seul `POST` est exporté) ; `web/app/api/playback/[id]/heartbeat/route.ts` (idem) ; contraste Django `api/apps/media/views.py:71-72` et `96-97` (`get` → `Http404()`), testé dans `api/apps/media/tests/test_endpoints.py:174-175` et `294-295`.
- **Constat** : le navigateur ne parle qu'à Next. `GET /api/lessons/1/playback` sur le port 3000 est un 405 Method Not Allowed, quel que soit l'`id`. Ça ne révèle pas l'existence d'une leçon, mais ça ne respecte pas le contrat « GET playback → 404 » côté surface exposée.
- **Règle enfreinte** : consigne d'étape / CLAUDE.md §4.1.1 (la surface client est `POST` ; les autres méthodes ne doivent rien confirmer).
- **Conséquence** : un probe de la façade Next n'a pas la même forme que Django. Faible, mais c'est exactement le genre de différence que l'étape 2 a déjà payée sur les 404 de chapitres.
- **Piste** : exporter un `GET` qui renvoie le même 404 que Django, ou un `http_method_names` équivalent.

### 9. Le libellé du filigrane n'est pas « nom + 4 chiffres »

- **Emplacement** : `api/apps/media/services.py:58-65` (`libelle_filigrane` : local-part de l'email + 4 derniers chiffres du téléphone, ou `visiteur`).
- **Constat** : `User` n'a pas de champ nom (`api/apps/accounts/models.py:24-25` : `email`, `phone`). Le local-part est identifiant, horodaté côté client (`filigrane.ts:57-61`). Ce n'est pas la formule du §4.1.4.
- **Règle enfreinte** : CLAUDE.md §4.1.4 — « superposition … contenant `nom + 4 derniers chiffres du téléphone + horodatage` ».
- **Conséquence** : une capture pirate portera `etudiante · 2233 · 09:05` plutôt qu'un nom. Exploitable pour tracer, mais pas le contrat écrit. Le jour où un nom apparaît au register, le filigrane ne le prendra pas tout seul.
- **Piste** : documenter l'écart (pas de nom au modèle) ou dériver d'un vrai champ identité quand il existera.

### 10. `LecteurVideo` accepte encore une URL de fichier et la pose sur `<video src>`

- **Emplacement** : `web/components/marketing/LecteurVideo.tsx:8-42` ; tests `web/tests/composants-marketing.test.tsx:58-65` qui passent encore `src: "/videos/x.mp4"`.
- **Constat** : `LecteurChapitre` n'utilise plus que `LecteurSecurise`, lequel n'appelle `LecteurVideo` qu'avec `src={null}` (`LecteurSecurise.tsx:241`). Le composant marketing, lui, joue toujours une source brute si on lui en donne une — c'est exactement le BLOQUANT de l'étape 2, déplacé d'un fichier, plus branché, toujours compilé.
- **Règle enfreinte** : CLAUDE.md §4.1.1 / §2 — jamais d'URL de fichier vidéo construite ni jouée hors jeton signé.
- **Conséquence** : une réutilisation future (landing, démo, story) reprend le chemin interdit sans que le type l'empêche. `src: string | null` autorise `/videos/x.mp4`.
- **Piste** : supprimer la branche `src` une fois `LecteurSecurise` en place, ou restreindre le type à `null`.

### 11. L'admin Django peut supprimer un `PlaybackToken`

- **Emplacement** : `api/apps/media/admin.py:29-33` (`has_add_permission` / `has_change_permission` à `False` ; pas de `has_delete_permission`).
- **Constat** : l'URL signée n'est pas stockée (correct, `models.py:3-6`). Supprimer la ligne ne coupe pas un HLS déjà démarré, mais efface la preuve de session unique et le matériau de `PLAYBACK_FLAGGED` (comptage sur `PlaybackToken.issued_at`). `AuditLogAdmin` refuse la suppression ; le jeton de lecture, objet de l'étape, non.
- **Règle enfreinte** : CLAUDE.md §4.6 — journal / traces d'accès vidéo immuables depuis l'interface ; le filet admin ne doit pas servir de second chemin métier.
- **Conséquence** : un coup d'œil « nettoyage » dans l'admin Django détruit l'historique de partage sans entrée d'audit.
- **Piste** : `has_delete_permission = False`, lecture seule comme le reste des champs.

### 12. Code mort et commentaires d'étape 2 laissés en place

- **Emplacement** : `api/apps/media/serializers.py:11` (`replace = serializers.UUIDField` jamais lu ; le commentaire de `views.py:47-48` dit qu'il n'est pas lu) ; `web/middleware.ts:9` (« La frame Bunny sera ajoutée ici, explicitement, à l'étape 4 ») alors que `frame-src 'none'` est posé ligne 36, volontairement, pour du HLS maison ; `web/components/marketing/LecteurVideo.tsx:3-6` (commentaire « le chapitre est gratuit donc pas de watermark ») alors que le chemin réel watermarké est `LecteurSecurise`.
- **Constat** : rien de tout ça ne s'exécute de travers. Ça ment sur l'architecture actuelle (HLS + jeton CDN, pas d'iframe Bunny ; filigrane aussi sur le gratuit).
- **Règle enfreinte** : checklist du relecteur — code mort, commentaires périmés.
- **Conséquence** : la prochaine étape qui touchera la CSP ou le lecteur relira « on ajoutera la frame à l'étape 4 » et croira le travail non fait, ou recablera une iframe qui casse le IP locking.
- **Piste** : supprimer `replace`, aligner les commentaires sur le lecteur HLS + CSP actuelle.

### 13. `prod.py` n'exige aucune clé Bunny

- **Emplacement** : `api/config/settings/prod.py` (garde-fous sur `DJANGO_ADMIN_PATH`, `PAYMENT_PROOF_ENCRYPTION_KEY`, prix, CCP ; rien sur `BUNNY_TOKEN_AUTH_KEY` / `BUNNY_CDN_HOSTNAME`) ; `.env.example:32-38` (valeurs vides).
- **Constat** : un déploiement production démarre, l'émission refuse poliment en 503 (`services.py:218-219`) dès qu'une vidéo a un `video_provider_id`. C'est plus honnête qu'inventer une URL, et les clés vides sont documentées dans `base.py:160-163`. Ce n'est pas le même niveau d'exigence que le chiffrement des preuves, pourtant cette étape *est* la vidéo.
- **Règle enfreinte** : CLAUDE.md §4.6 — configuration de production explicite pour ce qui est non négociable ; l'étape 4 est « l'étape critique du projet » (`progress.md`).
- **Conséquence** : un `.env` de prod copié depuis l'exemple « pour démarrer » sert une plateforme dont le lecteur ne joue jamais, sans crash au boot. On le découvrira au premier étudiant `ACTIVE`.
- **Piste** : en production, refuser de démarrer si une leçon publiée existe sans clé de signature, ou exiger les deux variables Bunny comme les coordonnées CCP.

---

## Verdict

**PORTE OUVERTE** — 0 BLOQUANT, et les commandes CLAUDE.md §7 sont réellement vertes (ruff, format, mypy, makemigrations, eslint, tsc). Le cœur de l'étape est à sa place : métier dans `services.py` / `signing.py`, serializers explicites, `video_provider_id` hors API, GET Django → 404 identique, URL signée construite uniquement dans `signing.py`, pas de `m3u8` / `b-cdn.net` dans les vues ni les serializers, Zod sur les deux BFF, `"use client"` limité au lecteur, cookie `device` httpOnly, CSP `connect-src` / `media-src` bornés à l'hôte CDN, filigrane 15 % / 6 ancrages / 20 s / `pointer-events: none`, flagage sans blocage, `controlsList="nodownload"`.

Ça ne rend pas le scénario d'intégration tenu. Les MAJEUR 1 (session unique en course), 2 (faux « autre appareil » au renouvellement) et 7 (access 15 min sans refresh) cassent, chacun de leur côté, « un seul jeton actif », « reprendre sans interruption visible » et « une leçon se regarde jusqu'au bout ». Ce n'est pas un refus de porte §8 pour cet agent — il n'y a plus de lint rouge ni de violation sèche des serializers / `any` / hex — mais merger tel quel reposerait sur des tests séquentiels qui ne voient pas la course.

**Décompte** · BLOQUANT 0 · MAJEUR 7 · MINEUR 6

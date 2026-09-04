# Étape 05 — Revue de code

**Date** · 2026-09-04
**Branche relue** · `claude/etape-05-lecteur-video-71fc9n`, HEAD = `1cdba48` « feat: étape 5 — parcours et progression (le pipeline) ». Diff relu : `git show 1cdba48` (28 fichiers, +1939 / −94).
**Périmètre** · Backend : `api/apps/learning/{models,services,serializers,views,urls,admin}.py`, `api/apps/learning/migrations/0002_modulecompletion.py`, `api/apps/learning/tests/{conftest,test_services,test_views}.py`, `api/config/urls.py`, `api/tests/test_urls.py`. Frontend : `web/app/(student)/app/page.tsx`, `web/app/(student)/app/chapitre/[chapitre]/page.tsx`, `web/components/student/{Pipeline,NoeudPipeline}.tsx`, `web/components/course/{BoutonTerminerChapitre,LecteurChapitre}.tsx`, `web/lib/{progress,progress-schemas}.ts`, `web/app/api/chapters/[slug]/complete/route.ts`, `web/app/globals.css`, tests `web/tests/*`.

**Note de périmètre.** Trois fichiers ne sont pas dans le commit d'étape et sont présents dans l'arbre de travail : `api/apps/learning/tests/test_soft_gating.py` (non suivi), `web/tests/pipeline-accessibilite.test.tsx` (non suivi), `web/tests/enrollment-pages.test.tsx` (modifié). Ils ont été lus et sont inclus dans les exécutions de tests ci-dessous, mais ils ne font pas partie de la livraison committée. À committer avant la porte, sinon la couverture annoncée n'existe pas dans l'historique.

## Commandes exécutées et résultat brut

Docker n'est pas disponible dans cette session (`/var/run/docker.sock` absent) : tout a été exécuté depuis `api/.venv` et `web/node_modules`, avec un PostgreSQL 16 local.

| Commande | Résultat |
|---|---|
| `api/.venv/bin/ruff check .` | vert — `All checks passed!` |
| `api/.venv/bin/ruff format --check .` | vert — `130 files already formatted` |
| `api/.venv/bin/mypy apps config` (strict) | vert — `Success: no issues found in 135 source files` |
| `manage.py makemigrations --check --dry-run` | `No changes detected` |
| `pytest -q --cov=apps.learning` | **521 passed**, `apps/learning` à **99 %** (`services.py` 100 %, `views.py` 100 %, `serializers.py` 100 %, seul `models.py:70-71` — le `__str__` de `ModuleCompletion` — n'est pas couvert) |
| `npm run lint` (`eslint .`) | vert, aucune sortie |
| `npm run typecheck` (`tsc --noEmit`) | vert, aucune sortie |
| `npx vitest run` | **486 passed**, 35 fichiers |
| `npm run build` (`next build`, env posé) | vert ; seules routes `○` : `/icon.svg`, `/robots.txt`, `/sitemap.xml` — aucune page applicative prérendue |
| `rg "fields = '__all__'"` sur `api/apps` | aucune occurrence hors commentaires qui l'interdisent |
| `rg ": any\|<any\|as any"` sur `web/{app,components,lib}` | aucune occurrence |
| `rg "#[0-9a-fA-F]{3,8}"` sur `web/{app,components,lib}` | rien de nouveau : `web/app/icon.svg` et un commentaire de `web/lib/filigrane.ts`, tous deux antérieurs à l'étape |
| `rg "TODO\|FIXME\|console.log"` sur `web/{app,components,lib}` et `api/apps` | aucune occurrence |
| `rg "localStorage\|sessionStorage"` sur `web/` | uniquement l'invariante qui les interdit (`web/tests/invariantes-cookies.test.ts`) — §4.2 respecté, le mécanisme `?termine=` ne passe par aucun stockage navigateur |
| `rg "403\|PermissionDenied"` sur `api/apps` hors tests | aucune levée : uniquement des commentaires qui rappellent la règle « 404, jamais 403 » |

**Comptage de requêtes SQL sur `GET /api/progress`** (test jetable, `CaptureQueriesContext`, cours de 2 modules / 3 chapitres, supprimé après mesure) : **11 requêtes**, dont 3 issues d'un `prefetch_related` jamais consommé et 2 requêtes `catalog_chapter` supplémentaires, une par module. Détail au MAJEUR 3.

Le socle §7 est donc réellement vert : serializers champ par champ, aucun `__all__`, aucun `any`, aucune valeur hexadécimale ajoutée dans un composant, `Pipeline` et `NoeudPipeline` sont des Server Components (seul `BoutonTerminerChapitre` porte `"use client"`, c'est un formulaire au sens du §7), Zod valide les deux réponses d'API consommées (`pipelineSchema`, `chapitreCompleteSchema`), aucun `fetch` navigateur ne vise Django. Le soft gating tient côté serveur : `POST /api/chapters/{slug}/complete` répond 200 sur un chapitre d'un module non terminé et 404 — jamais 403 — sur un refus de paywall, et le nœud « recommandé plus tard » reste un `<a href>` côté front.

---

## BLOQUANT

### 1. L'étiquette « tu en es ici » en safran sur paper mesure 2,05:1 — sous le plancher AA du §6

- **Emplacement** : `web/components/student/Pipeline.tsx:105-109` (`<span className="ml-2 text-[length:var(--texte-xs)] text-safran">tu en es ici</span>`).
- **Constat** : le seul libellé visible qui dit à l'étudiant où il en est est rendu en `--safran` (`#E0A22B`) sur `--paper` (`#FAFAF7`), à la plus petite taille de l'échelle (`--texte-xs`). Rapport de contraste calculé sur les tokens du §6 : **2,05:1**, contre 4,5:1 exigé pour du texte de cette taille. Le composant frère écrit à l'étape 3, `web/components/student/ParcoursEtudiant.tsx:70-74`, affiche exactement le même libellé en `text-ink` : l'étape 5 est une régression par rapport à ce qui existait.
- **Règle enfreinte** : CLAUDE.md §6, « Plancher de qualité, non négociable […] contraste AA ». Précédent des portes précédentes : `text-muted` sur `paper` à 4,36:1 (étape 1) puis 4,17:1 (étape 2) ont été classés BLOQUANT tous les deux ; 2,05:1 est deux fois plus bas.
- **Conséquence** : sur un téléphone Android en extérieur — le contexte d'usage décrit au §6 — l'unique indication « c'est ici que tu en es » est illisible. Le `sr-only` « — en cours » sauve le lecteur d'écran, pas l'utilisateur malvoyant ni personne au soleil.
- **Piste** : le safran est fait pour l'anneau du nœud, pas pour porter du texte ; l'information textuelle peut vivre dans une couleur qui passe AA sans toucher au token figé du §6.

### 2. Le chapitre d'un module non recommandé s'ouvre sans le bandeau de recommandation exigé par le scénario d'intégration

- **Emplacement** : `web/app/(student)/app/chapitre/[chapitre]/page.tsx:35-54` (la page rend un lien de retour, un titre, le nom du module et `LecteurChapitre` — rien d'autre) ; aucun appel à `recupererPipeline` ni à un quelconque état de progression n'y figure.
- **Constat** : `progress.md` étape 5, section *Intégration* : « Cliquer sur un module non recommandé → **il s'ouvre, avec un bandeau de recommandation**, pas une erreur. » La première moitié est vraie (le lien est cliquable, Django répond 200, vérifié par `test_soft_gating.py`), la seconde est absente : rien sur la page ne signale que ce chapitre arrive avant l'heure. Le §6 exige la même chose côté nœud (« tooltip *Passe d'abord l'examen du module 2* ») ; ni le nœud (voir MAJEUR 1 et 2) ni la page de destination ne portent l'explication.
- **Règle enfreinte** : `progress.md`, en-tête — « *Intégration* : le scénario concret à exécuter à la main pour prouver que ça marche. **Si le scénario ne passe pas, l'étape n'est pas finie.** » ; CLAUDE.md §2, la contrepartie du soft gating est la dévalorisation *explicite*, pas le silence.
- **Conséquence** : le soft gating perd sa moitié utile. Un étudiant qui saute au module 3 n'apprend nulle part qu'il vaut mieux finir le module 0 d'abord ; on a supprimé le cadenas sans le remplacer par le conseil, ce qui est le pire des deux mondes pour la complétion de la promo.
- **Piste** : la page de chapitre dispose déjà du slug ; l'état du module est calculé côté serveur et accessible en une lecture — reste à décider où l'afficher, en respectant §4.4 (un chapitre payant reste 404 pour un compte non actif).

---

## MAJEUR

### 1. L'infobulle « recommandé plus tard » désigne le mauvais module

- **Emplacement** : `web/components/student/Pipeline.tsx:94-98` — ``title={chapitre.state === "recommande_plus_tard" ? `Termine d'abord le module ${mod.order}.` : undefined}`` ; test qui fige le comportement : `web/tests/pipeline-composants.test.tsx:122`.
- **Constat** : `mod` est le module **du chapitre survolé**, c'est-à-dire précisément celui qui est verrouillé. Sur le jeu de données du test, le chapitre « Premier écran » du module 1 affiche « Termine d'abord le module 1. » — on demande à l'étudiant de terminer le module qu'il est en train d'ouvrir. Le §6 donne la formulation attendue et elle pointe le module **précédent** : « Passe d'abord l'examen du module 2 » sur un nœud du module 3.
- **Règle enfreinte** : CLAUDE.md §6, formulation de l'infobulle et « les erreurs disent quoi corriger ».
- **Conséquence** : la seule explication du soft gating est fausse et non actionnable. Le test la valide (`toContain("Termine d'abord le module")` ne compare pas le numéro), donc rien ne l'attrapera.
- **Piste** : la donnée manque côté serveur — `EtatModule` ne transporte pas quel module bloque celui-ci ; le calcul est déjà fait dans `calculer_pipeline` (`module_precedent_complet`).

### 2. L'infobulle passe par l'attribut `title` : invisible au clavier et au tactile

- **Emplacement** : `web/components/student/Pipeline.tsx:94-98`.
- **Constat** : `title` n'apparaît qu'au survol souris après un délai. Il ne s'affiche ni au focus clavier, ni sur un écran tactile — l'audience décrite au §6 est « majoritairement sur mobile Android ». Aucune alternative visible ou `sr-only` ne porte la raison de la recommandation (le `sr-only` existant ne dit que l'état, `Pipeline.tsx:101-104`).
- **Règle enfreinte** : CLAUDE.md §6, « tout l'écran étudiant utilisable au clavier » et « focus clavier visible partout » ; §2, le soft gating repose sur une infobulle qui explique.
- **Conséquence** : pour la majorité des utilisateurs réels, le nœud à 45 % d'opacité est juste un lien pâle sans explication — visuellement dévalorisé, jamais justifié.
- **Piste** : un mécanisme d'infobulle réellement atteignable au focus, ou une mention textuelle permanente sous le nœud.

### 3. `GET /api/progress` : un `prefetch_related` intégralement gaspillé et un N+1 par module

- **Emplacement** : `api/apps/learning/views.py:34` (`Course.objects.prefetch_related("modules__chapters__lesson")`) ; `api/apps/learning/services.py:146` (`course.modules.all().order_by("order").prefetch_related("chapters")`) ; `api/apps/learning/services.py:158` (`mod.chapters.all().order_by("order")`).
- **Constat** : mesuré, 11 requêtes pour un cours de 2 modules / 3 chapitres. Le `.order_by()` posé sur `course.modules.all()` et sur `mod.chapters.all()` invalide le cache de préchargement à chaque fois : les trois requêtes du prefetch de la vue (`catalog_module`, `catalog_chapter`, `catalog_lesson`) sont exécutées puis jetées, les modules sont relus, et **une requête `catalog_chapter` supplémentaire part par module**. Les deux `order_by` sont par ailleurs redondants : `Module.Meta.ordering = ["order"]` et `Chapter.Meta.ordering = ["order"]` (`api/apps/catalog/models.py:33,55`). Enfin `calculer_pipeline` n'utilise **jamais** la leçon : le niveau `__lesson` du prefetch charge tous les `transcript` du cours (champs `TextField` volumineux) à chaque affichage du tableau de bord, pour rien.
- **Règle enfreinte** : CLAUDE.md §7 — code mort ; qualité générale, duplication de préchargement entre la vue et le service qui ne se parlent pas.
- **Conséquence** : sur la vraie formation (une dizaine de modules), le tableau de bord fait une dizaine de requêtes évitables et transfère l'intégralité des transcriptions à chaque chargement, sur des connexions décrites comme « moyennes » au §6. Le coût grandit linéairement avec le catalogue.
- **Piste** : soit le service assume seul son chargement et la vue ne préfetche rien, soit les `order_by` disparaissent au profit de l'ordre déclaré par `Meta` pour que le prefetch serve à quelque chose.

### 4. `ChapitreInaccessibleError` n'est jamais levée : la règle d'accès est restée dans la vue

- **Emplacement** : `api/apps/learning/services.py:71-72` (déclaration + docstring « Traduit en 404 (§4.3, §4.4) ») ; `api/apps/learning/views.py:66-72` (les deux règles réelles — cours dépublié, chapitre payant sans inscription active — sont écrites dans le `post`).
- **Constat** : `rg ChapitreInaccessibleError` sur `api/` et `web/` ne retourne que la ligne de définition. Aucune levée, aucun import, aucun test. La classe documente une intention — faire porter la décision d'accès par le service — que le code ne suit pas : la vue interroge elle-même `chapter.module.course.is_published` et `enrollment_services.a_acces_au_contenu`.
- **Règle enfreinte** : CLAUDE.md §7 — « logique métier dans `apps/<app>/services.py`, pas dans les vues » et absence de code mort.
- **Conséquence** : deux endroits décideront bientôt de la même chose (le catalogue le fait déjà dans `apps/catalog/views.py`), et l'exception morte laissera croire au prochain lecteur que le service protège l'accès. À l'étape 6, `POST /api/quizzes/...` devra reproduire la règle une troisième fois.
- **Piste** : soit le service porte la décision et lève, soit l'exception disparaît et le commentaire dit franchement que la vue arbitre.

### 5. Le pipeline ignore le paywall : un compte non actif reçoit « disponible » sur des chapitres payants

- **Emplacement** : `api/apps/learning/views.py:25-41` (`ProgressView` n'est gardée que par `IsAuthenticated`, aucun appel à `a_acces_au_contenu`) ; `api/apps/learning/services.py:130-135` (`_etat_chapitre` ne connaît que la progression et le déverrouillage de module).
- **Constat** : un compte `PENDING`, `BLOCKED` ou `EXPIRED` qui appelle `GET /api/progress?course=…` reçoit `state: "disponible"` sur des chapitres que `GET /api/chapters/{slug}` lui refuse en 404. Le front masque le problème en n'appelant l'endpoint que si `statut === "ACTIVE"` (`web/app/(student)/app/page.tsx:42-45`) — c'est-à-dire que la cohérence tient à une condition côté client. Aucune fuite de contenu ici (les titres sont déjà publics par `/api/public/course/{slug}`), c'est une incohérence d'état, pas une faille.
- **Règle enfreinte** : CLAUDE.md §7 — duplication de logique, « deux endroits qui calculent la même chose » : `ParcoursEtudiant` calcule l'ouverture depuis `is_free` + statut, `calculer_pipeline` la calcule depuis la progression, et les deux se contredisent pour le même compte.
- **Conséquence** : à l'étape 6 ou 7, le premier consommateur qui appellera `/api/progress` sans reproduire la condition du tableau de bord affichera un parcours entièrement « disponible » à un compte qui n'a rien payé. La correction sera alors dans trois fichiers.
- **Piste** : faire entrer le droit d'accès dans le calcul d'état, une seule fois, au même endroit que les trois autres états.

### 6. Une erreur de l'API affiche un parcours vide au lieu de dire ce qui ne va pas

- **Emplacement** : `web/lib/progress.ts:19-22` (`if (!result.ok || result.status !== 200) return null;` puis `parsed.success ? parsed.data : null`) ; `web/app/(student)/app/page.tsx:111-120` (`pipeline ? <Pipeline/> : cours ? <ParcoursEtudiant/> : <p>…`).
- **Constat** : les quatre situations — Django injoignable, 401 sur access token expiré, 404, réponse de forme inattendue — se réduisent au même `null`. Pour un compte `ACTIVE`, l'écran retombe alors silencieusement sur `ParcoursEtudiant`, qui affiche tous les chapitres en « disponible », aucun nœud terminé, aucune barre de progression, et aucun message.
- **Règle enfreinte** : CLAUDE.md §6 — « Les erreurs disent quoi corriger, elles ne s'excusent pas » ; §7 — gestion des cas limites ; critère de `progress.md` « L'état du pipeline survit à un rechargement ».
- **Conséquence** : un incident transitoire se présente à l'étudiant comme « ta progression a été effacée ». C'est le pire message possible sur un produit payant, et il est indiscernable d'un vrai reset côté utilisateur.
- **Piste** : distinguer au moins « pas chargé » de « rien de fait », et laisser l'écran le dire.

### 7. Deux composants de parcours coexistent et divergent déjà

- **Emplacement** : `web/components/student/Pipeline.tsx:16-120` et `web/components/student/ParcoursEtudiant.tsx:20-90`.
- **Constat** : même structure (`<ol>` par module, `<ol>` de chapitres avec `border-l border-muted/40 pl-6`, nœud absolu `-left-[1.6rem] top-1 h-3 w-3`), deux tables `CLASSES_NOEUD` distinctes, deux vocabulaires d'état (`"en-cours" | "disponible" | "verrouille"` contre `"termine" | "en_cours" | "disponible" | "recommande_plus_tard"`), et le même libellé « tu en es ici » rendu en `text-ink` d'un côté (`ParcoursEtudiant.tsx:71`) et en `text-safran` de l'autre (`Pipeline.tsx:106`, voir BLOQUANT 1). `NoeudPipeline` a été extrait pour le nouveau composant, l'ancien garde son `<span>` en ligne.
- **Règle enfreinte** : CLAUDE.md §7 — duplication ; §6 — « un seul design system ».
- **Conséquence** : toute correction visuelle du parcours (contraste, alignement du nœud, responsive 360 px) devra être faite deux fois, et l'écart entre les deux rendus se creusera à chaque étape. Un même étudiant voit d'ailleurs les deux composants selon son statut, à quelques minutes d'intervalle le jour de son activation.
- **Piste** : un seul composant de parcours, avec les états du serveur ; `ParcoursEtudiant` n'est qu'un pipeline dont tous les états viennent du paywall.

### 8. Le serpentin annoncé est une liste verticale à filet gauche

- **Emplacement** : `web/components/student/Pipeline.tsx:75` (`<ol className="mt-4 flex flex-col gap-3 border-l border-muted/40 pl-6">`) et `NoeudPipeline.tsx:22` (nœud posé en absolu sur ce filet).
- **Constat** : le rendu est une timeline rectiligne : un trait vertical, des pastilles alignées. Rien ne serpente, rien ne relie visuellement les modules entre eux. Le message de commit annonce pourtant « composant Pipeline (serpentin, …) ».
- **Règle enfreinte** : CLAUDE.md §6, « Le parcours (pipeline). Chemin vertical **en serpentin**, nœud par chapitre, groupé par module » ; `progress.md` étape 5, *Frontend*, premier livrable.
- **Conséquence** : le livrable visuel central de l'étape n'est pas celui décrit, et le commit affirme le contraire — la prochaine relecture partira du principe qu'il est fait.
- **Piste** : soit le serpentin est construit, soit le §6 est amendé explicitement (ce que seul l'utilisateur peut décider) et le message de commit corrigé.

### 9. Un module sans chapitre verrouille tout le reste de la formation, définitivement

- **Emplacement** : `api/apps/learning/services.py:185` — `module_precedent_complet = len(chapitres) > 0 and termines == len(chapitres)`.
- **Constat** : un module dont les chapitres ne sont pas encore semés (état normal pendant la rédaction du contenu, et le seed de l'étape 2 ne couvre que le module 0) rend `module_precedent_complet` faux quoi que fasse l'étudiant. Tous les modules suivants restent `recommande_plus_tard` pour toujours, avec `0/0` en barre de progression et aucun moyen de débloquer. Aucun test ne couvre ce cas (`test_services.py` construit toujours des modules pourvus).
- **Règle enfreinte** : CLAUDE.md §7 — cas limites (« quoi si la valeur est nulle »).
- **Conséquence** : rien n'est bloqué au sens serveur (soft gating), mais la totalité du parcours passe à 45 % d'opacité et le bouton « Reprendre » cesse de proposer le bon chapitre — `resume_fallback` ne retient que les états `disponible` (`services.py:171-172`). Un trou de contenu se traduit par un parcours entier dévalorisé.
- **Piste** : décider explicitement ce que vaut un module vide pour le déverrouillage, et l'écrire dans un test.

### 10. Le texte des nœuds « recommandé plus tard » tombe à 2,81:1

- **Emplacement** : `web/components/student/Pipeline.tsx:79-83` (`opacity-45` posé sur le `<li>`, donc sur le lien et son libellé).
- **Constat** : `--ink` sur `--paper` à 45 % d'opacité donne un rapport mesuré de **2,81:1**, sous le seuil AA. Le §6 impose littéralement « `recommandé plus tard` : opacité 45 % » et, quatre lignes plus bas, « contraste AA » comme plancher non négociable : les deux consignes se contredisent dès qu'on applique l'opacité au texte plutôt qu'au seul indicateur. Le même choix existe depuis l'étape 3 sur l'état `verrouille` de `ParcoursEtudiant.tsx:56` — l'étape 5 l'étend, elle ne l'invente pas.
- **Règle enfreinte** : CLAUDE.md §6, plancher de qualité (en tension avec la consigne d'opacité du même §6). Classé MAJEUR et non BLOQUANT précisément parce que le §6 prescrit l'opacité noir sur blanc, contrairement au safran du BLOQUANT 1.
- **Conséquence** : la moitié du parcours est illisible pour une partie des utilisateurs, sur l'écran qui est censé leur montrer où ils vont.
- **Piste** : appliquer la dévalorisation au nœud et au décor plutôt qu'au corps du texte, ou faire trancher la contradiction par l'utilisateur (le §6 ne se modifie pas sans son accord explicite).

### 11. Le bouton de complétion ignore l'état déjà enregistré

- **Emplacement** : `web/components/course/BoutonTerminerChapitre.tsx:14-19` (état initial toujours `"repos"`, aucune prop d'état serveur) ; `web/app/(student)/app/chapitre/[chapitre]/page.tsx:32-52` (la page ne lit aucune progression) ; `web/components/course/LecteurChapitre.tsx:84-88`.
- **Constat** : sur un chapitre déjà `DONE`, la page propose à nouveau « Marquer ce chapitre comme terminé », sans indiquer qu'il l'est déjà. L'appel est idempotent côté serveur (`services.terminer_chapitre`, vérifié par `test_complete_est_idempotent`), donc rien ne casse — mais l'écran ment sur l'état. Symétriquement, le lecteur reprend bien à la position enregistrée (étape 4) alors que la complétion, elle, n'a aucune mémoire.
- **Règle enfreinte** : CLAUDE.md §7 — cas limites ; critère `progress.md` « L'état du pipeline survit à un rechargement et à un changement d'appareil », qui n'est vrai que sur `/app`, pas sur la page de chapitre.
- **Conséquence** : l'étudiant reclique, repart vers `/app?termine=…`, et rejoue l'animation de complétion d'un chapitre terminé depuis une semaine. L'unique moment de mouvement de l'app perd sa signification.
- **Piste** : la page de chapitre a déjà de quoi connaître l'état ; reste à le passer au bouton.

### 12. Aucun rafraîchissement de session : le bouton échoue après quinze minutes de lecture

- **Emplacement** : `web/components/course/BoutonTerminerChapitre.tsx:23-37` (un 401 tombe dans `setEtat("erreur")`) ; `web/app/api/chapters/[slug]/complete/route.ts:41-46` (le BFF relaie bien un 401 distinct) ; aucun appel à `/api/auth/refresh` n'existe dans `web/` (grep).
- **Constat** : `progress.md` étape 1, *Reporté explicitement* : « Aucun code n'appelle encore `POST /api/auth/refresh` […] Le rafraîchissement silencieux côté client est **à construire à l'étape 5** (parcours), quand l'espace étudiant aura des appels répétés à enchaîner. » L'étape 5 introduit exactement ces appels répétés et ne construit pas le rafraîchissement. Le BFF distingue proprement le 401 du reste ; le client, lui, écrase les deux cas dans « Impossible d'enregistrer pour l'instant. Réessaie dans un instant. » — un conseil faux, puisque réessayer échouera aussi.
- **Règle enfreinte** : CLAUDE.md §4.2 (access 15 min / refresh 7 jours rotatif — la moitié refresh reste inutilisée) ; §6, « les erreurs disent quoi corriger » ; dette explicitement datée de l'étape 5 par `progress.md`.
- **Conséquence** : un chapitre vidéo dure plus de 15 minutes. Le geste central de l'étape — marquer terminé à la fin de la leçon — est donc le plus susceptible de tomber sur un access token expiré, et l'étudiant reste bloqué sur un message qui lui dit de recommencer.
- **Piste** : soit le rafraîchissement silencieux annoncé, soit au minimum un traitement distinct du 401 qui renvoie vers la connexion en conservant la destination (le pattern existe déjà : `page.tsx:28`, `redirect("/connexion?suite=…")`).

---

## MINEUR

1. **`ModuleCompletion` est une table sans producteur.** `api/apps/learning/models.py:47-71`, migration `0002`, `admin.py:17-21` : le modèle est créé, migré, exposé à l'admin, et aucun code ne l'écrit jamais — `rg ModuleCompletion` ne trouve que le modèle, l'admin et un import de test. La docstring l'assume (« posée pour l'étape 6 ») et `progress.md` la liste bien en livrable, mais `progress.md` dit aussi que `POST /api/chapters/{id}/complete` « calcule l'état du module » : cet état est recalculé à la volée à chaque `GET`, jamais persisté. À l'étape 6, vérifier qu'on ne se retrouve pas avec deux vérités sur la complétion d'un module.
2. **La route ne correspond pas au plan.** `progress.md` annonce `POST /api/chapters/{id}/complete` ; l'implémentation est `POST /api/chapters/{slug}/complete` (`api/apps/learning/urls.py:11`). Le slug est cohérent avec le reste du catalogue et `Chapter.slug` est unique globalement — le choix est bon, mais `progress.md` n'a pas été mis à jour. Même remarque pour `GET /api/progress`, annoncé sans paramètre et qui exige en réalité `?course=<slug>` sous peine de 404 (`views.py:32-38`).
3. **Message d'erreur sans `role="alert"`.** `web/components/course/BoutonTerminerChapitre.tsx:60-65` : le `<p className="… text-danger">` n'est pas annoncé. Les six autres messages d'erreur du projet portent tous `role="alert"` (`FormulaireConnexion.tsx:67`, `FormulaireInscription.tsx:106`, `FormulaireRecu.tsx:152`, `FormulaireNouveauMotDePasse.tsx:52`, `FormulaireListeAttente.tsx:95`, `FileInscriptions.tsx:64`). Idem pour la confirmation « Chapitre marqué terminé. » (`ligne 42-45`), qui remplace le bouton sans être annoncée.
4. **Message de throttling dupliqué.** « Trop de tentatives. Réessaie plus tard. » existe en dur des deux côtés : `api/apps/learning/views.py:22` et `web/app/api/chapters/[slug]/complete/route.ts:37`. Deux chaînes à changer pour une seule correction de copie.
5. **Appel réseau inutile et sérialisé sur le tableau de bord.** `web/app/(student)/app/page.tsx:32-45` : `recupererCours()` est toujours appelé, puis n'est rendu que si `pipeline` est nul — pour un compte `ACTIVE` c'est un aller-retour vers Django jeté à chaque chargement. Et `recupererPipeline()` est attendu *après* le `Promise.all`, donc en série derrière les deux autres, alors qu'il n'en dépend pas.
6. **`?termine=` reste dans l'URL.** `BoutonTerminerChapitre.tsx:34` fait un `router.push("/app?termine=…")` ; le paramètre survit au rechargement, au partage du lien et au retour arrière, donc l'unique animation de l'app rejoue à chaque fois. Le choix d'un paramètre d'URL plutôt qu'un stockage navigateur est **le bon** au regard du §4.2 (aucun `localStorage`/`sessionStorage` dans tout `web/`, vérifié) ; c'est sa persistance qui n'est pas nettoyée.
7. **Typage lâche d'une table de correspondance.** `web/components/student/Pipeline.tsx:16` : `TEXTE_ETAT: Record<string, string>` alors que `EtatNoeud` existe et est utilisé juste à côté (`NoeudPipeline.tsx:11`, `Record<EtatNoeud, string>`). Un état ajouté à l'étape 6 rendrait `TEXTE_ETAT[chapitre.state]` silencieusement `undefined` au lieu d'échouer à la compilation.
8. **Deux transitions au survol de plus.** `Pipeline.tsx:33` et `BoutonTerminerChapitre.tsx:54` ajoutent `transition-opacity hover:opacity-90`, alors que le §6 dit « Un seul moment de mouvement dans toute l'app […] Pas de transition au survol sur chaque carte ». Le motif vient des étapes 1 à 3, l'étape 5 l'étend au lieu de le réduire.
9. **La même contrainte unique est gérée de deux façons.** `services.py:43-51` (`enregistrer_position` : `get_or_create` enveloppé dans un `try/except IntegrityError` ajouté à l'étape 4) contre `services.py:85-94` (`terminer_chapitre` : `select_for_update().get_or_create(...)` dans un `@transaction.atomic`). Les deux fonctions défendent l'invariante `progress_unique_user_chapitre` par deux mécanismes différents ; noter que `select_for_update` ne verrouille rien quand la ligne n'existe pas encore — c'est le rattrapage interne de `get_or_create` qui sauve la mise, pas le verrou.
10. **Trois fichiers hors du commit d'étape** (voir *Note de périmètre*). `test_soft_gating.py` couvre précisément trois des cinq critères « Terminé quand » : tant qu'il n'est pas committé, ces critères ne sont prouvés par rien dans l'historique.
11. **`SLUG_FORMATION_PRINCIPALE = "flutter-firebase-debutants"`** (`web/lib/catalog.ts:19`) est désormais aussi la clé du pipeline (`page.tsx:44`). La constante est antérieure à l'étape et le backend, lui, reste générique ; mais le §1 (« le domaine métier est *formation*, jamais *formation Flutter* en dur ») se rappellera au bon souvenir du front le jour de la deuxième formation.

---

## Verdict

**PORTE FERMÉE.**

Le socle technique est solide et honnête : `ruff`, `ruff format`, `mypy --strict`, `makemigrations --check`, `eslint`, `tsc --noEmit`, `next build`, 521 tests backend (99 % sur `apps.learning`) et 486 tests frontend sont tous verts, réellement exécutés. Le cœur de l'étape est juste : le soft gating tient côté serveur — aucun 403 nulle part, 404 identique pour un refus de paywall et pour un chapitre inexistant, complétion idempotente, aucune route ne prend d'identifiant d'utilisateur, aucun `localStorage`/`sessionStorage`, aucun `any`, aucun `__all__`, aucun hexadécimal en dur ajouté, la logique de calcul vit bien dans `services.py`.

Ce qui ferme la porte tient en deux points, tous deux du côté de l'écran : l'unique indication « c'est ici que tu en es » est écrite à 2,05:1 sur fond papier, très en dessous du plancher AA que le §6 déclare non négociable et que les portes des étapes 1 et 2 ont déjà fait respecter à deux reprises pour des écarts trois fois moindres ; et le scénario d'intégration de l'étape, que `progress.md` déclare éliminatoire, demande un bandeau de recommandation à l'ouverture d'un module non recommandé — il n'existe pas. Le soft gating a bien retiré le cadenas ; il n'a pas encore posé le conseil qui le remplace, ni dans l'infobulle (qui désigne le mauvais module et n'est atteignable ni au clavier ni au doigt), ni sur la page de destination.

**Remarques : 2 BLOQUANT · 12 MAJEUR · 11 MINEUR.**

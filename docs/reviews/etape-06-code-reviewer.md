# Étape 06 — Revue de code

**Date** · 2026-09-04
**Branche relue** · `claude/etape-06-qcm-examens`, HEAD = `2b8bc4f` « feat: étape 6 — QCM de chapitre et examens de module ». Diff relu : `git show 2b8bc4f` (40 fichiers, +3195 / −30), base `4af7072`.
**Périmètre** · Backend : `api/apps/assessment/{models,services,serializers,views,urls,admin}.py`, `api/apps/assessment/migrations/0001_initial.py`, `api/apps/assessment/tests/{conftest,test_models,test_services,test_views}.py`, `api/apps/learning/{models,serializers,services}.py`, `api/apps/learning/tests/{test_views,test_soft_gating}.py`, `api/config/urls.py`, `api/tests/{test_urls,test_security_baseline}.py`, `api/apps/accounts/tests/test_invariantes.py`. Frontend : `web/lib/{assessment,assessment-schemas,progress-schemas}.ts`, `web/app/api/quizzes/[id]/attempts/route.ts`, `web/app/api/attempts/[id]/submit/route.ts`, `web/components/assessment/Qcm.tsx`, `web/app/(student)/app/qcm/[id]/page.tsx`, `web/app/(student)/app/chapitre/[chapitre]/page.tsx`, `web/components/course/LecteurChapitre.tsx`, `web/components/student/Pipeline.tsx`, tests `web/tests/*`.

**Note de périmètre.** L'étape a été committée pendant la relecture ; tout ce qui est cité ci-dessous est dans `2b8bc4f`. Rien n'est resté hors commit, contrairement à l'étape 5.

## Commandes exécutées et résultat brut

Docker indisponible dans cette session : exécution depuis `api/.venv` et `web/node_modules`, PostgreSQL 16 local.

| Commande | Résultat |
|---|---|
| `api/.venv/bin/ruff check .` | vert — `All checks passed!` |
| `api/.venv/bin/ruff format --check .` | **ROUGE** — `5 files would be reformatted, 136 files already formatted` : `apps/assessment/{models,serializers,services}.py`, `apps/assessment/tests/{conftest,test_views}.py` |
| `api/.venv/bin/mypy apps config` (strict) | vert — `Success: no issues found in 146 source files` |
| `manage.py makemigrations --check --dry-run` | `No changes detected` |
| `pytest -q --cov=apps.assessment --cov-report=term-missing` | **578 passed**, 2 erreurs d'environnement (base `test_anisdev` verrouillée par une session résiduelle de ma propre session — `pytest tests/test_health.py --create-db` repasse : `11 passed`). `apps/assessment` à **99 %** ; non couverts : `services.py:215` et `serializers.py:94` (voir MAJEUR 8) |
| `npm run lint` (`eslint .`) | vert, aucune sortie |
| `npx tsc --noEmit` | vert, aucune sortie |
| `npx vitest run` | **561 passed**, 41 fichiers |
| `rg "fields = '__all__'"` sur `api/apps` | aucune occurrence hors les docstrings qui l'interdisent |
| `rg ": any\|<any>\|as any"` sur `web/{app,components,lib}` | aucune occurrence |
| `rg "#[0-9a-fA-F]{3,6}"` sur `web/{app,components,lib}` | rien de nouveau : `web/app/icon.svg` et un commentaire de `web/lib/filigrane.ts`, antérieurs à l'étape |
| `rg "TODO\|FIXME\|console.log\|print("` sur `web/{app,components,lib}` et `api/apps` | aucune occurrence |
| `rg "dangerouslySetInnerHTML"` sur `web/` | uniquement `web/app/(marketing)/page.tsx:58` (JSON-LD, antérieur). Les explications de QCM sont rendues en texte React (`Qcm.tsx:209`) — le point 8 de la checklist §8 est traité par construction |

Le socle §7 est réellement tenu sur l'essentiel : serializers champ par champ (`apps/assessment/serializers.py` déclare 25 champs à la main, aucun `__all__`), toute la correction vit dans `services.py` et les vues ne font que traduire des exceptions en codes HTTP, `soumettre_tentative` et `demarrer_tentative` sont sous `@transaction.atomic`, la migration `0001_initial` correspond exactement aux modèles (`makemigrations --check` muet), aucun `any`, aucun hexadécimal, `Qcm.tsx` est le seul `"use client"` ajouté et c'est un formulaire au sens du §7, Zod valide les trois formes d'API consommées, et les deux Route Handlers sont les seuls points de contact navigateur→Django.

Les cinq critères « Terminé quand » de `progress.md` sont vérifiés par des tests réels : `is_correct` absent de `GET /api/quizzes/{id}` (`test_views.py:30`), durée plancher (`:190`), quota (`:105`), IDOR sur `submit` (`:268`), score envoyé par le client ignoré (`:147`). Ce qui suit ne remet pas ces cinq points en cause.

---

## BLOQUANT

### 1. `ruff format --check` est rouge sur cinq fichiers de l'étape : la CI de la branche échoue

- **Emplacement** : `api/apps/assessment/models.py:70-74`, `api/apps/assessment/serializers.py:82-84`, `api/apps/assessment/services.py:93-95` et `:210-212`, `api/apps/assessment/tests/conftest.py:107-111`, `api/apps/assessment/tests/test_views.py:309-311`.
- **Constat** : `ruff format --check .` répond `5 files would be reformatted`. Les cinq écarts sont des retours à la ligne posés à la main là où le formateur veut une seule ligne (par exemple `models.py:71-73`, un `UniqueConstraint` éclaté sur trois lignes alors qu'il tient en 99 colonnes). Tous les fichiers concernés sont créés par l'étape 6 ; les 136 autres fichiers du dépôt passent.
- **Règle enfreinte** : CLAUDE.md §7, « `ruff` + `mypy` en mode strict sur `apps/` » ; `.github/workflows/ci.yml:61-62`, étape `ruff format` → `run: ruff format --check .` ; `README.md:59`, la commande de contrôle documentée du projet. Les tableaux de porte des étapes précédentes (`progress.md:85`, `:307`) déclarent explicitement `ruff format` en vert.
- **Conséquence** : le job `api` de la CI échoue à la troisième étape, avant `mypy`, avant `pytest`, avant `check --deploy`. La branche ne peut pas être mergée sur `main` : au sens du §7 (« Rien n'est mergé sur `main` tant que les trois sous-agents ne sont pas passés au vert »), l'étape n'est pas livrable, et aucun des contrôles qui suivent dans le pipeline n'est même exécuté sur cette branche.
- **Piste** : la commande de mise en forme existe déjà et est documentée dans le README ; il reste à l'exécuter avant de committer, et à comprendre pourquoi elle a été sautée sur cette étape alors qu'elle passait aux cinq précédentes.

---

## MAJEUR

### 1. Rien n'impose qu'une question ait exactement une bonne réponse — la correction prend silencieusement la première

- **Emplacement** : `api/apps/assessment/services.py:235-236` (`bonne_reponse = next((c for c in choix_liste if c.is_correct), None)` puis `est_correcte = bonne_reponse is not None and choix_choisi_id == bonne_reponse.id`) ; `api/apps/assessment/models.py:80-90` (`Choice`, aucun `constraints`) ; `api/apps/assessment/admin.py:18-21` (`ChoiceInline`, aucune validation de `formset`).
- **Constat** : le modèle autorise zéro, une, ou dix bonnes réponses par question, et l'admin — le seul outil de saisie de contenu (§1) — n'en dit rien. Deux comportements en découlent, tous deux muets : une question à **deux** `is_correct` n'accepte que le choix de plus petit `order` (le second est compté faux alors qu'il est marqué correct en base) ; une question à **zéro** `is_correct` est mathématiquement inéchouable — `bonne_reponse` vaut `None`, `est_correcte` est toujours faux, quelle que soit la réponse. Aucun test de l'étape ne construit une question hors du gabarit « deux choix, un correct » de `conftest.py:73-79`.
- **Règle enfreinte** : CLAUDE.md §7 — cas limites (« quoi si la valeur est nulle ») ; §4.4, la correction est « intégralement côté Django », donc c'est à Django de garantir qu'une question est corrigible.
- **Conséquence** : une case décochée par inadvertance dans l'admin rend une question impossible à réussir. Si elle est dans un examen de module, le seuil de réussite peut devenir inatteignable pour toute la promo, et le module suivant reste `recommandé plus tard` pour tout le monde — sans le moindre signal, ni en base, ni dans les logs.
- **Piste** : la contrainte « exactement une bonne réponse par question » se pose au même niveau que `quiz_xor_chapitre_module`, qui est déjà défendue en base et pas seulement dans l'application.

### 2. Un examen sans question verrouille définitivement le reste du parcours

- **Emplacement** : `api/apps/assessment/services.py:259` (`score = round((correctes / total) * 100) if total > 0 else 0`) ; `api/apps/learning/services.py:224-226` (`module_precedent_complet = termines == len(chapitres) and (exam_quiz_id is None or exam_passed)`).
- **Constat** : un `Quiz` attaché à un module mais encore vide de questions — l'état normal entre la création de l'examen dans l'admin et la saisie de son contenu — produit `score = 0` à chaque soumission, donc `reussi = 0 >= pass_threshold` faux pour tout seuil supérieur à zéro, donc `exam_passed` jamais posé, donc `module_precedent_complet` définitivement faux. La docstring de `calculer_pipeline` (`api/apps/learning/services.py:149-153`) affirme pourtant que « un module sans chapitre ou sans examen compte comme complet sur ce point : rien à y faire ne doit pas verrouiller la suite indéfiniment ». La protection couvre l'examen *absent*, pas l'examen *vide*.
- **Règle enfreinte** : CLAUDE.md §7 — cas limites. C'est exactement la classe de bug relevée à l'étape 5 (MAJEUR 9, « Un module sans chapitre verrouille tout le reste de la formation, définitivement »), corrigée pendant cette porte, et réintroduite ici par une autre porte d'entrée.
- **Conséquence** : rien n'est refusé côté serveur (le soft gating tient), mais toute la formation en aval passe à 45 % d'opacité, le bouton « Reprendre » cesse de proposer le bon chapitre, et l'étudiant peut soumettre l'examen autant de fois que `max_attempts` l'autorise sans jamais pouvoir le réussir. Le seul indice, côté admin, serait de regarder les `Attempt` à 0 %.
- **Piste** : décider ce que vaut un examen sans question — refuser de le servir, ou le traiter comme absent — et l'écrire dans un test, comme cela a été fait pour le module vide à l'étape 5.

### 3. La course de concurrence sur `demarrer_tentative` laisse dépasser `max_attempts`

- **Emplacement** : `api/apps/assessment/services.py:128-140`.
- **Constat** : `Attempt.objects.select_for_update().filter(user=…, quiz=…, submitted_at__isnull=True).first()` ne verrouille rien quand il ne ramène aucune ligne — `SELECT … FOR UPDATE` sur un ensemble vide ne pose aucun verrou. Deux `POST /api/quizzes/{id}/attempts` simultanés (double clic, deux onglets, un retry réseau) traversent donc tous les deux le `if ouverte is not None`, tous les deux le `if _tentatives_soumises(...) >= quiz.max_attempts`, et créent **deux** tentatives ouvertes. Rien en base ne l'interdit : `Attempt.Meta` (`models.py:109-111`) ne déclare qu'un `Index`, aucune `UniqueConstraint`. Le surplus n'est jamais nettoyé : `demarrer_tentative` en réutilisera une, l'autre restera ouverte et soumissible plus tard — au-delà du quota. C'est la même faiblesse que celle notée au MINEUR 9 de l'étape 5 sur `terminer_chapitre`, mais ici `get_or_create` n'est pas là pour rattraper.
- **Règle enfreinte** : CLAUDE.md §4.4, « limite le nombre de tentatives par examen » ; `progress.md` étape 6, critère « La limite de tentatives est appliquée côté serveur ». Le test qui couvre le quota (`test_views.py:105-124`) est strictement séquentiel.
- **Conséquence** : le plafond de tentatives, qui est la seule chose qui donne du poids à un examen de module (et donc au déverrouillage du pipeline), est franchissable par un geste aussi banal qu'un double clic sur « Commencer ».
- **Piste** : une invariante « au plus une tentative ouverte par (user, quiz) » exprimée en base rendrait la course inoffensive sans dépendre du verrou.

### 4. L'écran de résultat révèle toutes les bonnes réponses puis propose « Recommencer »

- **Emplacement** : `web/components/assessment/Qcm.tsx:194-207` (`choixCorrect = question.choices.find((c) => c.is_correct)` puis `` `Bonne réponse : ${choixCorrect?.text}` ``) et `:219-227` (bouton « Recommencer » dès que `attempts_remaining > 0`) ; côté serveur `api/apps/assessment/services.py:242-257`, qui renvoie `is_correct` pour **tous** les choix de **toutes** les questions.
- **Constat** : après un échec, l'étudiant lit la bonne réponse de chaque question, clique « Recommencer », et la deuxième tentative est nécessairement à 100 %. Les questions sont servies dans le même ordre (`Question.Meta.ordering = ["order"]`), les choix aussi, sans tirage. Pour un examen de module, cette deuxième tentative pose `ModuleCompletion.exam_passed = True` et déverrouille le module suivant. `pass_threshold` et `max_attempts` deviennent décoratifs dès qu'il reste une tentative.
- **Règle enfreinte** : tension interne à `progress.md` étape 6, qui demande à la fois « corrections question par question avec explication » et « bouton *Recommencer* si des tentatives restent », sans dire lequel gagne ; CLAUDE.md §4.4, « anti-triche QCM minimal » — le plafond de tentatives n'a de sens que si les tentatives sont indépendantes.
- **Conséquence** : le seul mécanisme qui fait qu'un examen mesure quelque chose est neutralisé par l'écran qui le suit. À l'étape 8, un certificat délivré sur la foi de `ModuleCompletion.exam_passed` ne certifiera rien.
- **Piste** : la correction complète et la relance sont deux besoins légitimes qui ne peuvent pas cohabiter à l'identique — c'est un arbitrage produit, à faire trancher (par exemple : corriger complètement seulement quand il ne reste plus de tentative, ou ne montrer que ce qui est faux sans dire ce qui est juste).

### 5. Un rejet « trop rapide » jette les réponses de l'étudiant, sans reprise possible

- **Emplacement** : `web/components/assessment/Qcm.tsx:91-98` — sur un 400, `setEtape({ phase: "erreur", message: detail })` ; la phase `"erreur"` (`:153-167`) ne porte ni `attemptId` ni `reponses` et n'affiche qu'un message et un lien de retour.
- **Constat** : `Quiz.min_duration_s` vaut **20 s par défaut** (`api/apps/assessment/models.py:38`). Un QCM de fin de chapitre fait deux ou trois questions : répondre en moins de vingt secondes est le cas nominal, pas une attaque. Le serveur répond alors 400, et le composant détruit l'état : les réponses saisies disparaissent, il n'y a pas de bouton « Réessayer », et la seule issue est le lien « Retour à ton parcours ». Le test qui couvre ce chemin s'intitule pourtant `« soumission trop rapide (400) : le message du serveur s'affiche, rien n'est perdu »` (`web/tests/qcm-composant.test.tsx:205`) et n'assère que le texte de l'alerte — il fige un comportement contraire à son propre nom.
- **Règle enfreinte** : CLAUDE.md §6, « Les erreurs disent quoi corriger, elles ne s'excusent pas » — ici l'erreur dit quoi corriger (« réponds plus lentement ») mais retire les moyens de le faire ; §7, gestion des cas limites.
- **Conséquence** : le premier étudiant rapide de la promo perd son travail sur le premier QCM de la formation. Comme `demarrer_tentative` réutilise la tentative ouverte, revenir sur la page redonne bien la même tentative — mais avec un questionnaire vierge, ce que rien n'explique.
- **Piste** : l'erreur de rythme est récupérable par nature ; l'état de la tentative n'a aucune raison d'être détruit pour l'afficher.

### 6. `soumettre_tentative` ne revérifie jamais le droit d'accès au quiz

- **Emplacement** : `api/apps/assessment/services.py:190-208` ; à comparer avec `views.py:68` et `:91`, où `a_acces_au_quiz` garde `GET /api/quizzes/{id}` et le démarrage.
- **Constat** : la soumission ne contrôle que la propriété de la tentative (`filter(pk=attempt_id, user=user)`). Le droit d'accès au contenu n'est vérifié qu'au démarrage. Entre les deux, l'inscription peut passer à `BLOCKED` ou `EXPIRED` (`Enrollment.Status`), ou l'admin peut dépublier le cours : la tentative ouverte reste soumissible indéfiniment, et si c'est un examen de module, elle pose `ModuleCompletion.exam_passed` et déverrouille le pipeline d'un compte bloqué. Aucun test ne couvre ce scénario.
- **Règle enfreinte** : CLAUDE.md §4.3, « Contrôle **au niveau de l'objet** sur chaque endpoint qui prend un id » — la propriété de la tentative n'est pas le droit d'accès au contenu qu'elle porte ; §2, le blocage d'un compte est censé fermer l'accès.
- **Conséquence** : le blocage d'un compte, qui est l'outil de dernier recours de l'admin (§7 de `progress.md`, étape 7), laisse une porte ouverte via une tentative pré-ouverte. À l'étape 7, `POST /api/admin/students/{id}/block` promettra une fermeture immédiate qu'il ne pourra pas tenir.
- **Piste** : les deux endpoints qui prennent un id de quiz passent déjà par `a_acces_au_quiz` ; celui qui prend un id de tentative dispose du quiz par `select_related`.

### 7. Un compte `PENDING` n'a aucun chemin vers le QCM du chapitre gratuit

- **Emplacement** : `api/apps/assessment/services.py:48-50` (un QCM de chapitre gratuit est explicitement ouvert à tous, avec son test dédié `test_views.py:52`) ; côté front, `web/components/student/ParcoursEtudiant.tsx:62-66` envoie un compte non actif vers `/gratuit/{slug}`, et `web/app/gratuit/[chapitre]/page.tsx:56` rend `<LecteurChapitre chapitre={chapitre} />` — sans `avecSuiviDeProgression`, sans `quizId`. Le lien « Passer le QCM du chapitre » n'existe que sous `avecSuiviDeProgression` (`web/components/course/LecteurChapitre.tsx:93-107`).
- **Constat** : le tableau de bord d'un compte `PENDING` rend `ParcoursEtudiant` et non `Pipeline` (`web/app/(student)/app/page.tsx:40-46`, condition `statut === "ACTIVE"`), donc aucun `quiz_id` ne lui parvient jamais. Le seul écran qu'il peut atteindre pour le chapitre gratuit est `/gratuit/{slug}`, où le lien n'est pas rendu. La capacité existe côté serveur, elle est testée, elle est inatteignable côté produit.
- **Règle enfreinte** : CLAUDE.md §1, parcours d'inscription — « Il accède immédiatement au Module 0 / Chapitre 1 (gratuit, sans paiement) » ; §7, code mort au sens fonctionnel : une branche de service et son test entretiennent une capacité que rien ne consomme.
- **Conséquence** : le visiteur qui vient de créer un compte — la population exacte que l'entonnoir doit convaincre — voit la leçon gratuite mais pas le QCM qui lui prouverait qu'il a appris quelque chose. C'est la conséquence directe de la coexistence de deux composants de parcours (étape 5, MAJEUR 7), qui coûte ici sa première fonctionnalité.
- **Piste** : soit `/gratuit/{slug}` reçoit le `quiz_id`, soit la divergence `ParcoursEtudiant`/`Pipeline` est refermée avant que l'étape 7 n'en ajoute une troisième.

### 8. Le rejet d'un id de question étranger au quiz n'est couvert par aucun test

- **Emplacement** : `api/apps/assessment/services.py:213-215` (`if any(qid not in ids_questions_valides for qid in reponses): raise ReponsesInvalidesError`) — ligne **215 non couverte** dans le rapport `--cov-report=term-missing` ; `api/apps/assessment/serializers.py:93-94` (`if question_id <= 0`) — ligne **94 non couverte**.
- **Constat** : `apps.assessment` est à 99 %, et les deux seules lignes manquantes sont sur le chemin de validation des réponses — c'est-à-dire précisément la surface d'attaque du point 3 de la checklist §8. `test_soumettre_refuse_un_choix_totalement_etranger_au_quiz` (`test_views.py:246`) ne couvre que la **seconde** garde (l'id de *choix*) ; personne ne vérifie qu'un `{"<id d'une question d'un autre quiz>": <choix valide>}` est bien rejeté. Le corollaire est que rien n'empêcherait quelqu'un de supprimer ces trois lignes sans faire rougir la suite.
- **Règle enfreinte** : CLAUDE.md §8, agent 2 — « chemin nominal, chemin d'erreur, et cas limite pour chaque endpoint » ; §4.4, la validation d'une soumission est du ressort du serveur, donc elle se teste.
- **Conséquence** : le seul rempart contre l'injection d'ids de questions arbitraires dans `Attempt.answers` n'a aucun filet de régression, alors que le score et `ModuleCompletion` en dépendent.
- **Piste** : les deux gardes de `soumettre_tentative` sont symétriques ; leurs tests ne le sont pas encore.

### 9. Dépendance croisée entre `learning` et `assessment`

- **Emplacement** : `api/apps/learning/services.py:18` (`from apps.assessment.models import Quiz`) et `api/apps/assessment/services.py:20` (`from apps.learning.models import ModuleCompletion`).
- **Constat** : chaque application importe désormais les modèles de l'autre. Il n'y a pas de cycle d'import Python à l'exécution (les `models` n'importent pas les `services`), mais le graphe de dépendances entre applications est bouclé : `calculer_pipeline` va chercher les quiz, et `soumettre_tentative` écrit dans `ModuleCompletion`, qui appartient à `learning`. Aucune des deux applications ne peut plus être lue, testée ou déplacée seule.
- **Règle enfreinte** : CLAUDE.md §3, l'arborescence sépare `learning/` (progression, déblocage) de `assessment/` (scoring) précisément pour que le déblocage ne dépende pas du scoring ; §7, logique métier localisée.
- **Conséquence** : à l'étape 8, `certification` devra lire les deux, et il n'existera aucun endroit unique qui réponde à « ce module est-il acquis ? ». La question est aujourd'hui tranchée à deux endroits : `assessment/services.py:182` (pose `exam_passed`) et `learning/services.py:224-226` (le relit et l'agrège). Le premier import qui remontera d'un `models` vers un `services` fermera le cycle pour de bon.
- **Piste** : une seule des deux applications doit posséder la notion « module acquis » ; l'autre l'interroge par une fonction, pas par un modèle.

### 10. Deux sources de vérité pour le meilleur score d'un examen

- **Emplacement** : `api/apps/assessment/services.py:93-95` (`best_score` de `EtatQuiz` = `Max("score")` sur les tentatives soumises) et `:179-181` (`ModuleCompletion.best_score`, ratchet qui ne redescend jamais).
- **Constat** : pour un examen de module, le même nombre est calculé de deux façons et stocké à deux endroits. Ils coïncident aujourd'hui parce que rien ne supprime de tentative, mais ils ne sont liés par aucune contrainte : une suppression de `Attempt` (cascade sur `User` ou `Quiz`, purge future) fait redescendre l'agrégat et laisse `ModuleCompletion.best_score` figé sur une valeur que plus aucune tentative ne justifie. Le choix du ratchet est bon et explicitement demandé — c'est sa cohabitation avec un recalcul à la volée qui pose problème.
- **Règle enfreinte** : CLAUDE.md §7 — duplication de logique, « deux endroits qui calculent la même chose ».
- **Conséquence** : à l'étape 7, la fiche étudiant affichera des scores ; selon la source retenue, deux écrans donneront deux chiffres différents pour le même examen, et il n'y aura aucun moyen de dire lequel a raison.
- **Piste** : décider laquelle des deux est la source, et faire dériver l'autre — ou assumer explicitement que `ModuleCompletion.best_score` est un historique et non un reflet.

### 11. Aucune donnée de démonstration : le scénario d'intégration de l'étape n'est pas exécutable

- **Emplacement** : `api/apps/catalog/management/commands/seed_course.py` — `rg "Quiz|Question|Choice"` n'y trouve **aucune** occurrence ; les seuls quiz existants sont les fixtures de test (`api/apps/assessment/tests/conftest.py:66-91`).
- **Constat** : `progress.md` étape 6, *Intégration* : « Passer un QCM de chapitre, échouer, recommencer, réussir. Puis passer l'examen du module 0 et voir le module 1 passer de `recommandé plus tard` à `disponible` dans le pipeline. » Sur une base fraîchement semée, aucun `Quiz` n'existe : `quiz_id` et `exam_quiz_id` valent `null` partout, donc ni le lien « Passer le QCM du chapitre » (`LecteurChapitre.tsx:98`) ni le lien « Passer l'examen du module » (`Pipeline.tsx:96`) ne s'affichent, et le scénario ne peut pas commencer sans saisir à la main quatre questions dans l'admin Django.
- **Règle enfreinte** : `progress.md`, en-tête — « *Intégration* : le scénario concret à exécuter à la main pour prouver que ça marche. **Si le scénario ne passe pas, l'étape n'est pas finie.** »
- **Conséquence** : personne — ni la revue, ni le testeur, ni l'utilisateur — ne peut voir la fonctionnalité fonctionner de bout en bout sans travail préalable non documenté. Le déverrouillage du module 1 par l'examen du module 0, qui est le cœur de l'étape, n'a été observé que dans un test unitaire (`test_views.py:316`).
- **Piste** : la commande de seed sait déjà créer modules, chapitres et leçons ; elle n'a jamais été étendue au nouveau contenu.

---

## MINEUR

1. **Transformation identité morte.** `web/components/assessment/Qcm.tsx:76-78` : `Object.fromEntries(Object.entries(reponses).map(([q, c]) => [q, c]))` est une copie superficielle déguisée en conversion. Aucune clé n'est transformée (elles sont déjà des chaînes, `Object.entries` s'en charge), aucune valeur non plus. Trois lignes qui suggèrent une sérialisation qui n'existe pas.
2. **`retourHref` contredit sa propre documentation.** `Qcm.tsx:11-12` : « Vers le chapitre pour un QCM, vers le parcours pour un examen. » `web/app/(student)/app/qcm/[id]/page.tsx:59` passe `"/app"` dans les deux cas. La cause est structurelle — `EtatQuiz` ne transporte ni le slug du chapitre ni celui du module — mais le commentaire décrit un comportement qui n'a jamais existé, et l'étudiant qui finit le QCM d'un chapitre est renvoyé au tableau de bord plutôt qu'à sa leçon.
3. **Branche inatteignable dans le récapitulatif d'examen.** `Qcm.tsx:258` affiche « Pas de réponse » quand aucun choix n'est retenu, mais les boutons « Suivant » et « Vérifier avant d'envoyer » sont `disabled` tant que la question n'a pas de réponse (`:338`, `:353`) : on ne peut pas atteindre le récapitulatif avec une question vide. Code mort, ou garde-fou pour une évolution non annoncée.
4. **Un quiz sans question rend un écran blanc.** `Qcm.tsx:284-285` : `const question = quiz.questions[index]; if (!question) return null;`. Après « Commencer » sur un quiz vide, la page ne contient plus rien — ni message, ni lien de retour. Voir MAJEUR 2 pour la version serveur du même trou.
5. **Bouton désactivé sans explication.** `Qcm.tsx:338` et `:353` : rien ne dit à l'étudiant qu'il doit choisir une réponse pour continuer. §6, « Les erreurs disent quoi corriger ». Un bouton grisé silencieux est la forme la moins actionnable du message.
6. **Trois champs transportés puis ignorés.** `web/lib/assessment-schemas.ts:24-26` valide `max_attempts`, `min_duration_s` et `attempts_used` ; `rg` sur `web/{app,components,lib}` ne trouve aucun autre usage. `min_duration_s` en particulier est la donnée qui permettrait d'éviter le rejet décrit au MAJEUR 5, et elle arrive jusqu'au composant sans être lue.
7. **Message de repli faux sur un 400 sans `detail`.** `web/app/api/attempts/[id]/submit/route.ts:61-66` et `Qcm.tsx:91-98` supposent tous deux qu'un 400 de Django porte un `detail`. Le 400 émis par `SubmitRequestSerializer` (`serializers.py:92`, `:94`, ou `IntegrityError` de `min_value=1`) est un 400 DRF de la forme `{"answers": [...]}` : le repli affiche alors « Réponds un peu plus lentement avant d'envoyer. » pour une erreur de forme. Chemin atteignable avec `{"answers": {"0": 5}}`, que le Zod du BFF laisse passer.
8. **Test dont le nom dit l'inverse de son assertion.** `api/apps/assessment/tests/test_views.py:220` — `test_soumettre_refuse_un_choix_dune_autre_question` assère `status_code == 200`. Le commentaire interne explique correctement la décision (un choix du bon quiz mais de la mauvaise question est *accepté* et noté faux) ; le nom, lui, sera lu de travers à la première régression.
9. **Préchargement inutile au démarrage d'une tentative.** `api/apps/assessment/views.py:31-49` : `_quiz_ou_404` précharge questions et choix pour les trois vues, alors que `QuizStartAttemptView` (`:90`) n'a besoin que de `max_attempts`, `chapter` et `module`. Deux requêtes jetées à chaque clic sur « Commencer ». Le préchargement est en revanche correctement consommé par `etat_quiz` — aucun `order_by` ne vient l'invalider, contrairement au défaut relevé à l'étape 5 (MAJEUR 3).
10. **Arrondi bancaire sur le score.** `api/apps/assessment/services.py:259` : `round()` en Python arrondit à l'entier pair. `round(62.5) == 62` mais `round(37.5) == 38` — deux fractions identiques arrondies dans des directions opposées. Sur un QCM de 8 questions avec un seuil à 63, 5 bonnes réponses donnent 62 et échouent d'un point invisible.
11. **Chaînes de message dupliquées, jusqu'à quatre fois.** « Tu as utilisé toutes tes tentatives pour ce QCM. » vit dans `api/apps/assessment/views.py:98`, `web/app/api/quizzes/[id]/attempts/route.ts:40`, `Qcm.tsx:54` et `Qcm.tsx:131`. « Réponds un peu plus lentement avant d'envoyer. » dans `views.py:138`, `submit/route.ts:65`, `Qcm.tsx:96`. « Trop de tentatives. Réessaie plus tard. » atteint désormais quinze occurrences dans le dépôt. Le motif est antérieur (étape 5, MINEUR 4) ; l'étape 6 l'aggrave sans le questionner.
12. **Safran sur un panneau d'échec.** `Qcm.tsx:181` : `border-l-2 border-safran` encadre le score, réussi **comme** échoué. Le §6 réserve le safran à « c'est ici que tu en es ». Le motif a un précédent dans le projet (`app/(student)/app/page.tsx:65`, `chapitre/[chapitre]/page.tsx:78`, `activation/page.tsx:82`), toujours pour marquer l'étape courante ; un résultat d'examen raté n'est pas une étape courante.
13. **Le lien d'examen échappe à la dévalorisation du soft gating.** `web/components/student/Pipeline.tsx:91-104` : « Passer l'examen du module » est rendu en zellige plein, hors du `<li>` qui porte `opacity-45` (`:110-114`), y compris pour un module dont aucun chapitre n'est terminé. Le seul élément mis en avant d'un module verrouillé est donc son examen.
14. **La sentinelle `is_correct` a été élargie plus que nécessaire.** `api/apps/accounts/tests/test_invariantes.py:38-40` exclut désormais **tout** `/apps/assessment/`, `views.py` compris, du contrôle textuel. Le contrôle par introspection de `api/tests/test_security_baseline.py:98-112` rattrape le cas des serializers avec une liste blanche d'un seul nom — c'est le bon niveau de granularité — mais rien ne couvre plus un `is_correct` écrit à la main dans `apps/assessment/views.py`. L'exclusion pourrait viser le fichier, pas l'application.
15. **Aucune annonce du changement de question.** `Qcm.tsx:291-293` : « Question 2/2 » remplace « Question 1/2 » sans `aria-live`, et le focus reste sur le bouton « Suivant ». Un lecteur d'écran ne signale rien. §6, « tout l'écran étudiant utilisable au clavier ».
16. **`exam_passed` ne redescend jamais, et rien ne permet de le reprendre.** `api/apps/assessment/services.py:182-185` (le ratchet, correct et voulu) combiné à `admin.py:54-67` et à l'admin en lecture seule de `ModuleCompletion` (étape 5) : si un examen est publié avec une bonne réponse erronée et qu'une partie de la promo le « réussit », il n'existe aucun chemin supporté pour revenir en arrière. Ni route, ni admin, ni service.
17. **`.gitignore` ne couvre pas les fichiers de couverture parallèles.** Quatre `api/.coverage.vm.pid*` traînaient en non suivis au moment de la relecture. `.gitignore:15` ne déclare que `.coverage`, sans le motif `.coverage.*` que `coverage` produit dès qu'il écrit plusieurs fichiers.
18. **Le titre de la page de QCM ne nomme rien.** `web/app/(student)/app/qcm/[id]/page.tsx:53-55` : « QCM de chapitre » ou « Examen de module », sans dire lequel. L'étudiant qui arrive par un lien collé ne sait pas ce qu'il s'apprête à passer. Le contournement est comprensible (`EtatQuiz` ne transporte pas le titre du chapitre, et exposer ce titre pour un contenu payant serait un oracle d'existence) mais mérite d'être tranché plutôt que subi.
19. **Le verbe du bouton n'est pas repris.** §6 : « un bouton dit ce qu'il fait […] et le message de succès reprend le même verbe ». « Envoyer » / « Envoyer mes réponses » débouche sur « Réussi » ou « Score insuffisant ». Le précédent du projet fait l'inverse (`BoutonTerminerChapitre` : « Marquer ce chapitre comme terminé » → « Chapitre marqué terminé. »). Au passage, le même geste porte deux libellés selon le type de quiz.
20. **`exam_quiz_id` est servi à un compte sans droit sur le module.** `api/apps/learning/views.py` n'ajoute aucun contrôle de paywall à `GET /api/progress` (dette de l'étape 5, MAJEUR 5), et l'étape 6 y ajoute l'id des examens de modules payants. Ce n'est qu'un entier et `a_acces_au_quiz` ferme la porte derrière, mais la surface exposée à un compte `PENDING` grandit à chaque étape sans que la garde n'ait bougé. À confirmer par le security-tester.

---

## Verdict

**PORTE FERMÉE.**

Le cœur de l'étape est solide et bien placé. La correction est intégralement côté Django, `is_correct` ne sort qu'après `submitted_at` — et le test qui le garantit a été affiné avec discernement, par introspection et liste blanche d'un seul serializer plutôt qu'en désactivant la sentinelle. Les cinq critères « Terminé quand » de `progress.md` sont chacun couverts par un test réel. La logique vit dans `services.py`, les vues ne font que traduire des exceptions, les transitions d'état sont atomiques, la migration correspond aux modèles, la contrainte `quiz_xor_chapitre_module` est défendue en base et pas seulement en Python, le prefetch de `_quiz_ou_404` est cette fois réellement consommé, aucun `any`, aucun `__all__`, aucun hexadécimal, aucun `TODO`. `mypy --strict`, `eslint`, `tsc --noEmit`, 578 tests backend à 99 % sur `apps.assessment` et 561 tests frontend sont verts.

Ce qui ferme la porte est mécanique : `ruff format --check .` échoue sur cinq fichiers créés par cette étape, et c'est la troisième commande du job `api` de la CI. La branche ne peut pas passer sur `main`, et aucune des vérifications suivantes du pipeline n'est même atteinte. C'est un écart de trente secondes à corriger, mais tant qu'il est là, l'étape n'est pas livrable au sens du §7.

Derrière ce blocage, deux familles de remarques méritent d'être traitées avant la porte plutôt qu'à l'étape 7. D'abord la robustesse du contenu : rien n'impose qu'une question ait exactement une bonne réponse, et un examen vide verrouille définitivement la suite du parcours — soit exactement la classe de bug corrigée pendant la porte de l'étape 5, revenue par une autre porte. Ensuite le sens de l'examen lui-même : l'écran de résultat livre toutes les bonnes réponses puis propose « Recommencer », ce qui rend la deuxième tentative triviale et le déverrouillage du module suivant automatique ; le quota de tentatives, seul garde-fou restant, est franchissable par un double clic faute d'invariante en base. Enfin, la fonctionnalité n'a jamais tourné de bout en bout : `seed_course` ne crée aucun quiz, donc le scénario d'intégration que `progress.md` déclare éliminatoire n'a pas pu être joué.

**Remarques : 1 BLOQUANT · 11 MAJEUR · 20 MINEUR.**

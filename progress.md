# progress.md — plan d'exécution

Lire `CLAUDE.md` avant toute étape. Les étapes sont **séquentielles** : ne pas commencer l'étape N+1 tant que la porte de contrôle de l'étape N n'est pas franchie.

**Comment lire une étape**
- *Objectif* : ce qui existe à la fin et n'existait pas avant.
- *Backend* / *Frontend* : les livrables des deux côtés.
- *Intégration* : le scénario concret à exécuter à la main pour prouver que ça marche. Si le scénario ne passe pas, l'étape n'est pas finie.
- *Terminé quand* : les critères objectifs.
- *Porte* : les trois sous-agents de CLAUDE.md §8.

**Légende** : `[ ]` à faire · `[~]` en cours · `[x]` terminé (mettre la date)

---

## Étape 0 — Fondations du dépôt

**Objectif.** Deux projets qui démarrent ensemble, une base connectée, une CI qui casse quand le code est mauvais. Aucune fonctionnalité métier.

**Backend**
- `api/` : Django 5 + DRF, settings découpés `base/dev/prod`, PostgreSQL, Argon2 en tête des `PASSWORD_HASHERS`.
- Applications vides créées avec la structure de CLAUDE.md §3.
- `ruff`, `mypy` strict, `pytest` + `pytest-django` configurés.
- Endpoint `GET /api/health` → `{"status": "ok", "db": "ok"}`.

**Frontend**
- `web/` : Next.js 15 App Router, TypeScript strict, Tailwind, `eslint`.
- Tokens du §6 de CLAUDE.md déclarés en variables CSS dans `styles/tokens.css`, polices chargées via `next/font`.
- Page `/` provisoire qui affiche l'échelle typographique et la palette (page de référence pour le design, à supprimer à l'étape 2).
- Route Handler `/api/health` qui appelle Django côté serveur et renvoie le résultat.

**Intégration**
`docker compose up` démarre postgres + api + web. Ouvrir `http://localhost:3000/api/health` dans le navigateur → réponse `ok` provenant de Django. L'onglet réseau ne montre **aucun** appel vers le port de Django.

**Terminé quand**
- [ ] `docker compose up` fonctionne depuis un clone vierge en suivant le README
- [ ] `.env.example` complet, `.env` dans `.gitignore`, aucun secret commité
- [ ] `ruff`, `mypy`, `eslint`, `tsc --noEmit` passent sans erreur
- [ ] CI GitHub Actions qui exécute lint + types + tests sur chaque push

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(focus : secrets dans le dépôt, `DEBUG`, CORS, exposition du port Django)*

---

## Étape 1 — Comptes et authentification

**Objectif.** Quelqu'un peut créer un compte, se connecter, se déconnecter, réinitialiser son mot de passe. Sécurisé selon CLAUDE.md §4.2. Aucun contenu de formation n'existe encore.

**Backend**
- Modèle `User` custom (email comme identifiant), `Session` avec familles de refresh tokens.
- `POST /api/auth/register` (email, téléphone, mot de passe) — crée l'utilisateur + un `Enrollment` en `PENDING`.
- `POST /api/auth/login`, `POST /api/auth/refresh` (rotatif, détection de rejeu), `POST /api/auth/logout`, `POST /api/auth/logout-all`.
- `POST /api/auth/password-reset/request` et `/confirm` — token usage unique, TTL 30 min, révoque toutes les sessions.
- `GET /api/me`.
- Rate limiting effectif sur les cinq endpoints sensibles. Réponses et temps de réponse identiques que le compte existe ou non.
- Validation de mot de passe : 10 caractères minimum, vérification contre une liste de mots de passe communs.

**Frontend**
- Écrans : inscription, connexion, mot de passe oublié, nouveau mot de passe. Design selon §6, pas de kit générique.
- Route Handlers Next qui posent et lisent les cookies httpOnly. Aucun token visible côté navigateur.
- Middleware Next qui protège `/app` et `/admin` et redirige vers la connexion.
- États vides et messages d'erreur rédigés selon le §6 (dire quoi corriger).

**Intégration**
Créer un compte → recevoir l'email de bienvenue (console en dev) → se déconnecter → se reconnecter → demander une réinitialisation → changer le mot de passe → constater que **les sessions ouvertes sur un autre navigateur sont bien coupées**. Vérifier dans DevTools que `localStorage` et `sessionStorage` sont vides et que le cookie porte `httpOnly`, `Secure`, `SameSite=Strict`.

**Terminé quand**
- [ ] Un refresh token rejoué invalide toute la famille et déconnecte
- [ ] 6 tentatives de connexion échouées en 15 min renvoient un 429
- [ ] Connexion avec un email inexistant et avec un mauvais mot de passe donnent la même réponse
- [ ] Aucune route ne permet à un tiers de définir le mot de passe d'un autre compte
- [ ] Tests : ≥ 80 % sur `apps/accounts`

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(checklist §8 points 6 et 3 en priorité)*

---

## Étape 2 — Landing publique et chapitre gratuit

**Objectif.** Un visiteur découvre la formation et regarde gratuitement le Module 0 / Chapitre 1, sans compte payant. C'est le haut de l'entonnoir : cette page vend.

**Backend**
- Modèles `Course`, `Module`, `Chapter`, `Lesson` avec le flag `is_free`.
- `GET /api/public/course/{slug}` — structure de la formation : titres, résumés, durées. **Aucun contenu de leçon.**
- `GET /api/public/chapters/{id}` — renvoie le contenu **uniquement si `is_free`**, sinon 404.
- Seed de données : la vraie arborescence de la formation Flutter + Firebase (Module 0 « Mise en route » et ses chapitres réels), pas du lorem ipsum.
- `POST /api/public/leads` — email + téléphone pour la liste d'attente, avec rate limit et anti-bot (honeypot + délai minimum de soumission).

**Frontend**
- Landing `/` : héros = lecteur du chapitre gratuit intégré dans la page, parcours complet visible en dessous avec les modules à venir grisés. Puis programme, formats, prix, FAQ.
- `/gratuit/[chapitre]` : la leçon gratuite en plein écran, avec un appel à l'action clair à la fin.
- Métadonnées SEO, Open Graph, sitemap, données structurées `Course`.
- Score Lighthouse ≥ 90 en performance et accessibilité sur mobile.

**Intégration**
En navigation privée, arriver sur `/`, lire le chapitre gratuit en entier, laisser son email, puis tenter d'accéder à un chapitre payant par URL directe → 404 propre, pas de fuite de titre ni de contenu.

**Terminé quand**
- [ ] La landing est rédigée avec du vrai contenu, pas de placeholder
- [ ] Le chapitre gratuit est jouable sans compte
- [ ] Tout chapitre `is_free = false` est inaccessible par tous les chemins (API, route Next, HTML du SSR)
- [ ] Lighthouse mobile ≥ 90 perf et a11y
- [ ] Design relu contre le skill frontend-design : aucun des tells listés dans CLAUDE.md §6 n'est présent

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(point 4 : contournement du paywall, y compris via le HTML rendu côté serveur)*

---

## Étape 3 — Inscription payante et validation admin

**Objectif.** Un compte `PENDING` téléverse une preuve de versement CCP ; l'admin la consulte et bascule le compte en `ACTIVE`.

**Backend**
- `PaymentProof` avec le pipeline de sécurité complet de CLAUDE.md §4.5 : magic bytes, 5 Mo max, réencodage Pillow, bucket privé, nom UUID.
- `POST /api/enrollment/proof` (étudiant), `GET /api/enrollment/status` (étudiant).
- `GET /api/admin/enrollments` avec filtres par statut, `POST /api/admin/enrollments/{id}/accept`, `/reject` (motif obligatoire).
- `GET /api/admin/proofs/{id}/url` → URL signée TTL 10 min, consultation journalisée dans `AuditLog`.
- Tâche planifiée de purge des preuves 90 jours après validation.
- Emails transactionnels : preuve reçue, compte activé, preuve refusée avec motif.
- Interface `PaymentProvider` en place, avec `ManualCCPProvider` comme unique implémentation.

**Frontend**
- `/app/activation` : instructions CCP (numéro, montant, référence à mettre sur le bordereau), zone de dépôt du reçu avec aperçu, puis état d'attente honnête (« reçu envoyé, réponse sous 24 h »).
- Le tableau de bord étudiant en `PENDING` affiche le parcours complet avec le chapitre gratuit ouvert et le reste marqué comme verrouillé, pas une page vide.
- `/admin/inscriptions` : file d'attente, aperçu de la preuve, boutons accepter / refuser avec motif. Design sobre, dense, pensé pour traiter 30 demandes d'affilée.

**Intégration**
Compte A téléverse un reçu → l'admin le voit dans sa file → refuse avec motif → A reçoit l'email et peut renvoyer → l'admin accepte → A recharge et son parcours est ouvert. Vérifier ensuite qu'un `AuditLog` existe pour chacune des trois actions admin.

**Terminé quand**
- [ ] Un `.svg`, un `.php` renommé en `.jpg` et un fichier de 100 Mo sont tous rejetés
- [ ] Le fichier stocké n'est atteignable par aucune URL publique
- [ ] L'étudiant A ne peut pas récupérer la preuve de l'étudiant B (404)
- [ ] Un compte `PENDING` n'accède à aucun chapitre non gratuit
- [ ] L'EXIF est absent des images stockées

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(points 1, 4 et 7 — c'est l'étape la plus exposée du projet)*

---

## Étape 4 — Lecture vidéo sécurisée

**Objectif.** Un étudiant `ACTIVE` regarde une leçon. Le contenu est protégé selon CLAUDE.md §4.1. **C'est l'étape critique du projet.**

**Backend**
- Intégration Bunny Stream : pull zone en token auth, referrer allow-list, direct-play désactivé.
- Modèle `PlaybackToken`. `POST /api/lessons/{id}/playback` : vérifie l'inscription active ou le flag gratuit, invalide les tokens actifs de l'utilisateur, en émet un nouveau (TTL 5 min, lié à `user_id`, `lesson_id`, préfixe d'IP), journalise.
- Compteurs de détection de partage et bascule `flagged_for_review` selon les seuils du §4.1.6. **Jamais de blocage automatique.**
- Rate limit dédié sur l'émission de tokens.
- Aucune URL Bunny brute ne figure dans un serializer, un log ou une réponse d'erreur.

**Frontend**
- Composant `SecurePlayer` : demande un token, joue, redemande automatiquement avant expiration.
- Watermark dynamique : `nom + 4 derniers chiffres du téléphone + horodatage`, opacité 15 %, changement d'ancrage toutes les 20 s, `pointer-events: none`.
- `MutationObserver` + `IntersectionObserver` sur le nœud du watermark : suppression ou masquage → pause immédiate et nouvelle demande de token.
- Suivi de progression : envoi de `watched_s` toutes les 15 s, reprise à la position exacte.
- Téléchargement et menu contextuel neutralisés sur le lecteur.

**Intégration**
Se connecter, lire une leçon, la mettre en pause 10 min puis reprendre (le token a expiré, le lecteur en redemande un sans interruption visible). Ouvrir la même leçon sur un second appareil → la première session s'arrête. Supprimer le div du watermark dans DevTools → la vidéo se met en pause.

**Terminé quand**
- [ ] L'onglet réseau ne contient **aucune** URL de fichier vidéo directement rejouable
- [ ] Un token copié et rejoué après expiration échoue
- [ ] Un token copié et utilisé depuis une autre IP échoue
- [ ] Un token de l'étudiant A ne fonctionne pas pour l'étudiant B
- [ ] Le watermark est présent sur chaque image et impossible à faire disparaître durablement côté client
- [ ] Les seuils de détection déclenchent bien `flagged_for_review` sans couper l'accès

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(point 5, avec preuves d'exploitation. Une constatation ÉLEVÉE ici bloque tout le projet, pas seulement l'étape.)*

---

## Étape 5 — Parcours et progression (le pipeline)

**Objectif.** L'étudiant voit son parcours en serpentin, navigue entre chapitres et modules, et sa progression est enregistrée. **Soft gating** : rien n'est jamais verrouillé côté serveur pour un compte actif.

**Backend**
- `Progress`, `ModuleCompletion`. `GET /api/progress` renvoie l'état de chaque chapitre pour l'utilisateur courant.
- `POST /api/chapters/{id}/complete` — marque terminé, calcule l'état du module.
- Calcul de l'état affiché de chaque nœud : `terminé` / `en cours` / `disponible` / `recommandé plus tard`. La logique est côté serveur, le front ne fait qu'afficher.
- `last_activity_at` mis à jour à chaque appel authentifié.

**Frontend**
- Composant `Pipeline` : serpentin vertical, nœuds groupés par module, quatre états visuels du §6.
- Un nœud `recommandé plus tard` est à 45 % d'opacité, **cliquable**, avec une infobulle expliquant la recommandation. Aucun cadenas, aucun blocage.
- Une seule animation dans toute l'app : le passage d'un nœud à l'état terminé.
- Barre de progression par module. Bouton « Reprendre » qui ouvre le dernier chapitre en cours.
- Responsive à partir de 360 px : le serpentin reste lisible sur un écran étroit.

**Intégration**
Terminer trois chapitres d'affilée et voir le serpentin se remplir. Cliquer sur un module non recommandé → il s'ouvre, avec un bandeau de recommandation, pas une erreur. Recharger → l'état est identique. Ouvrir sur mobile 360 px → utilisable.

**Terminé quand**
- [ ] Aucun endpoint ne renvoie 403 pour un chapitre non terminé sur un compte `ACTIVE`
- [ ] L'état du pipeline survit à un rechargement et à un changement d'appareil
- [ ] Navigation complète au clavier avec focus visible
- [ ] `prefers-reduced-motion` désactive l'animation de complétion
- [ ] L'étudiant A ne peut pas lire ni modifier la progression de B

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(points 1 et 3)*

---

## Étape 6 — QCM de chapitre et examens de module

**Objectif.** Un QCM court à la fin de chaque chapitre, un examen à la fin de chaque module, corrigés intégralement côté serveur.

**Backend**
- `Quiz`, `Question`, `Choice`, `Attempt`.
- `GET /api/quizzes/{id}` — questions et choix **sans `is_correct`**. Vérifier ce point dans un test dédié.
- `POST /api/quizzes/{id}/attempts` (démarre, enregistre `started_at`), `POST /api/attempts/{id}/submit` (corrige, renvoie score + explications).
- Règles : nombre de tentatives maximum, durée minimale plancher, seuil de réussite paramétrable, mémorisation du meilleur score.
- Un examen réussi met à jour `ModuleCompletion` et change l'état du pipeline. Transaction atomique.

**Frontend**
- Écran QCM : une question à la fois, progression visible, pas de compte à rebours anxiogène pour les QCM de chapitre.
- Écran de résultat : score, corrections question par question avec explication, bouton « Recommencer » si des tentatives restent.
- Écran d'examen de module : format plus formel, récapitulatif avant soumission.
- Le rendu des explications passe par un assainissement strict (pas de `dangerouslySetInnerHTML` sur du contenu non nettoyé).

**Intégration**
Passer un QCM de chapitre, échouer, recommencer, réussir. Puis passer l'examen du module 0 et voir le module 1 passer de `recommandé plus tard` à `disponible` dans le pipeline. Inspecter la réponse de `GET /api/quizzes/{id}` : aucun champ ne révèle la bonne réponse.

**Terminé quand**
- [ ] `is_correct` n'apparaît dans **aucune** réponse d'API avant soumission
- [ ] Une soumission plus rapide que la durée plancher est rejetée
- [ ] La limite de tentatives est appliquée côté serveur
- [ ] Un étudiant ne peut pas soumettre une tentative appartenant à un autre
- [ ] Le score ne peut pas être envoyé ni influencé depuis le client

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(points 2, 1 et 8 — XSS stocké dans les explications)*

---

## Étape 7 — Back-office admin

**Objectif.** Anis pilote sa promo depuis une seule interface : qui est inscrit, qui paie, qui avance, qui décroche.

**Backend**
- `GET /api/admin/students` — liste avec `last_activity_at`, `%` de progression, dernier module terminé, statut, `flagged_for_review`. Filtres et tri côté serveur, pagination.
- `GET /api/admin/students/{id}` — fiche détaillée : progression module par module, scores, historique de paiement, journal d'accès vidéo.
- `POST /api/admin/students/{id}/block` et `/unblock` — motif obligatoire, journalisé.
- `POST /api/admin/students/{id}/send-reset` — envoie un lien de réinitialisation. **L'admin ne voit ni ne définit jamais un mot de passe.**
- `POST /api/admin/students/{id}/revoke-sessions`.
- `GET /api/admin/dashboard` — inscriptions en attente, actives, bloquées, taux de complétion par module, comptes signalés.
- `GET /api/admin/audit` — journal consultable, non modifiable.
- Toutes ces routes sous une permission `IsAdminUser` explicite, plus un test qui vérifie qu'un étudiant reçoit 404 sur chacune.

**Frontend**
- `/admin` : tableau de bord. Le chiffre qui compte en premier, c'est le nombre de preuves en attente.
- `/admin/etudiants` : tableau dense, tri, recherche, filtres. Pensé pour le clavier et pour un écran large.
- Fiche étudiant : timeline de progression, historique de paiement, indicateur de signalement avec le détail des seuils dépassés.
- `/admin/journal` : audit log en lecture seule.
- Aucun bouton dans toute l'interface ne permet de définir un mot de passe.

**Intégration**
Depuis le compte admin : trouver un étudiant inactif depuis 10 jours via le filtre, ouvrir sa fiche, voir qu'il est bloqué au module 2, lui envoyer un lien de réinitialisation, puis le bloquer et vérifier qu'il est immédiatement déconnecté et ne peut plus se reconnecter.

**Terminé quand**
- [ ] Un compte étudiant reçoit 404 sur **toutes** les routes `/api/admin/*`
- [ ] Le blocage révoque les sessions en cours immédiatement
- [ ] Chaque action admin produit une entrée d'audit
- [ ] Aucune route ni bouton de changement de mot de passe par un tiers
- [ ] Le journal d'audit n'est modifiable par aucune route

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(points 3 et 1 — escalade de privilèges et cloisonnement admin/étudiant)*

---

## Étape 8 — Certificat et page de vérification publique

**Objectif.** Un étudiant qui termine la formation reçoit un certificat vérifiable à une URL publique. Levier marketing : chaque certificat partagé porte le domaine anis.dev.

**Backend**
- `Certificate` avec `code_public` non devinable (aléatoire, pas séquentiel).
- Délivrance automatique quand tous les examens de modules sont réussis. Idempotent.
- `GET /api/public/verify/{code}` — renvoie prénom, nom de la formation, date. **Aucune donnée personnelle au-delà.** Rate limité contre l'énumération.
- Possibilité de révoquer un certificat (admin, journalisé).
- Génération d'un PDF téléchargeable.

**Frontend**
- `/verify/[code]` : page publique sobre, indexable, qui répond en une phrase « oui, cette personne a terminé cette formation le … ». Design soigné, c'est une vitrine.
- Écran de fin de formation avec téléchargement du PDF et bouton de partage LinkedIn pré-rempli.

**Intégration**
Terminer tous les modules sur un compte de test → certificat délivré → ouvrir l'URL de vérification en navigation privée → la page s'affiche correctement. Tenter des codes voisins → aucun ne résout.

**Terminé quand**
- [ ] Les codes ne sont pas énumérables (aléatoires + rate limit)
- [ ] La page publique ne divulgue ni email, ni téléphone, ni scores
- [ ] La délivrance est idempotente (pas de doublon en cas de double appel)

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(points 2 et 1)*

---

## Étape 9 — Emails et relances

**Objectif.** Le cycle de vie communique tout seul, et les décrocheurs sont relancés.

**Backend**
- File de tâches (Celery + Redis, ou `django-q` si on veut rester léger).
- Emails transactionnels : bienvenue, preuve reçue, compte activé, preuve refusée, réinitialisation, module terminé, certificat délivré.
- Relance automatique après 7 jours d'inactivité, une seule fois par module, avec désinscription possible.
- Templates HTML cohérents avec le design system, plus une version texte.

**Frontend**
- Écran de préférences de notification pour l'étudiant.
- Page de désinscription en un clic.

**Intégration**
Provoquer chaque événement sur un compte de test et vérifier que le bon email part, une seule fois, avec le bon contenu. Reculer `last_activity_at` de 8 jours et vérifier le déclenchement de la relance.

**Terminé quand**
- [ ] Aucun email n'est envoyé en double
- [ ] Les liens contiennent des tokens à usage unique
- [ ] Aucun contenu sensible (mot de passe, URL signée) dans un email
- [ ] La désinscription fonctionne et est respectée

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester

---

## Étape 10 — Durcissement, observabilité, mise en production

**Objectif.** Le système tient en production et on sait ce qui s'y passe.

**Backend**
- En-têtes complets : CSP stricte avec Bunny en allow-list, HSTS preload, `nosniff`, `X-Frame-Options: DENY`.
- Sentry ou équivalent, avec filtrage des données sensibles avant envoi.
- Sauvegardes PostgreSQL quotidiennes + **une restauration testée réellement**, pas seulement configurée.
- Rate limiting global en plus des limites par endpoint.
- `/admin/` de Django accessible uniquement par IP autorisée ou tunnel, jamais publiquement.
- Runbook dans `docs/ops.md` : déploiement, rollback, restauration, rotation de secrets.

**Frontend**
- Pages 404 et 500 rédigées, pas les pages par défaut de Next.
- Vérification finale du plancher de qualité du §6 sur tous les écrans : focus clavier, contraste, 360 px, mouvement réduit.
- Audit Lighthouse sur les pages publiques et les pages étudiant.

**Intégration**
Déployer en staging avec un domaine réel et HTTPS. Faire le parcours complet de bout en bout depuis un vrai téléphone Android sur réseau mobile : inscription, chapitre gratuit, versement simulé, activation, module 0 entier, examen, module 1. Chronométrer, noter tout ce qui frotte.

**Terminé quand**
- [ ] securityheaders.com note A ou mieux
- [ ] Une restauration de sauvegarde a été effectuée avec succès
- [ ] Le parcours complet passe sur un vrai téléphone en 4G
- [ ] Aucun secret ni trace d'exception n'apparaît dans une réponse de production
- [ ] `docs/ops.md` est écrit et suivable par quelqu'un d'autre

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(checklist §8 intégrale, sur l'environnement de staging cette fois, pas en local)*

---

## Étape 11 — Paiement automatique Chargily (optionnel, après la promo 1)

**Objectif.** Accepter CIB et EDAHABIA sans validation manuelle. À ne lancer qu'une fois le statut légal réglé et la promo 1 vendue.

**Backend**
- `ChargilyProvider` implémentant l'interface `PaymentProvider` posée à l'étape 3.
- Webhook de confirmation avec **vérification de signature** et **idempotence** (rejouer le webhook ne doit rien casser).
- Le paiement manuel CCP reste disponible en parallèle : BaridiMob reste le moyen le plus répandu.
- Activation automatique de l'inscription à la confirmation, journalisée comme les activations manuelles.

**Frontend**
- Choix du mode de paiement à l'inscription : carte, ou versement CCP.
- Écrans de retour : succès, échec, en attente.

**Intégration**
Paiement en sandbox de bout en bout, puis rejeu du webhook trois fois → une seule activation. Simuler un webhook avec une signature invalide → rejeté.

**Terminé quand**
- [ ] Signature de webhook vérifiée, non contournable
- [ ] Webhook idempotent
- [ ] Un webhook forgé n'active aucun compte
- [ ] Le chemin CCP manuel fonctionne toujours

**Porte** — [ ] code-reviewer · [ ] code-tester · [ ] security-tester *(faux webhook, rejeu, activation par manipulation du montant)*

---

## Journal des portes franchies

| Étape | Date | Reviewer | Tester | Security | Notes |
|---|---|---|---|---|---|
| 0 | | | | | |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |

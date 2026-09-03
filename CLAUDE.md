# CLAUDE.md — anis.dev / Plateforme de formation

Ce fichier est la constitution du projet. Il est lu à chaque session.
Si une instruction d'une conversation contredit ce fichier, **ce fichier gagne**, sauf si l'utilisateur dit explicitement « modifie CLAUDE.md ».

---

## 1. Produit

Plateforme de formation en ligne sous la marque **anis.dev**, marché algérien.
Première formation : **Flutter + Firebase pour débutants absolus**. La plateforme doit accueillir d'autres formations tech plus tard, donc le domaine métier est « formation », jamais « formation Flutter » en dur.

**Utilisateurs :**
- *Visiteur* — découvre la formation, regarde les démos, consulte le chapitre gratuit.
- *Étudiant* — inscrit et validé, suit les modules, passe les QCM.
- *Admin* — un seul (Anis). Valide les paiements, gère les adhérents, publie le contenu.

**Parcours d'inscription :**
1. Le visiteur crée un compte (email + téléphone + mot de passe). Statut `PENDING`.
2. Il accède immédiatement au **Module 0 / Chapitre 1** (gratuit, sans paiement).
3. Pour la suite : il verse sur le CCP, puis téléverse une capture du reçu.
4. L'admin vérifie et valide. Statut `ACTIVE`. L'accès complet s'ouvre.

**Modèle pédagogique :**
`Formation → Modules → Chapitres → (Leçon vidéo + QCM de fin de chapitre)`
Fin de module = examen (QCM plus long, seuil de réussite).

---

## 2. Décisions figées (ne pas rediscuter sans accord explicite)

| Sujet | Décision | Raison |
|---|---|---|
| Client web | **Next.js 15 (App Router) + TypeScript** | La landing publique a besoin de SSR/SEO (c'est l'entonnoir de vente), l'espace étudiant a besoin d'un SPA. Next fait les deux dans un seul projet. Un Vite+React pur obligerait à un second site pour le marketing. |
| Un seul front | Admin et étudiant dans **la même app Next**, routes séparées `/app` et `/admin` | Un seul design system, un seul déploiement. Le cloisonnement se fait côté API, pas côté bundle. |
| Backend | **Django 5 + Django REST Framework** | Choix de l'utilisateur, et l'admin Django sert de filet de sécurité pour les tâches rares. |
| Base | **PostgreSQL** | Contraintes, transactions, JSONB pour les réponses de QCM. |
| Vidéo | **Bunny Stream** (token-authenticated) | Voir §4. Jamais de MP4 servi par Django ou stocké en public. |
| Auth | Cookies **httpOnly + SameSite=Strict**, access court + refresh rotatif | Voir §4. Pas de JWT en localStorage. |
| Paiement | Manuel CCP + preuve téléversée. Chargily plus tard, derrière une interface `PaymentProvider`. | Le marché algérien. Ne pas coder en dur « CCP » partout. |
| Gating | **Soft gating** | Le module suivant est *dévalorisé visuellement* et marqué « recommandé après l'examen », mais reste cliquable. Ne jamais renvoyer 403 sur un module non terminé. |
| Correction manuelle | **Hors périmètre** | Pas d'upload de photos de résultats, pas de commentaires du formateur. Tous les QCM sont auto-corrigés côté serveur. |
| Statut « en ligne » | **Hors périmètre** | Pas de WebSocket, pas de présence temps réel. On affiche `last_activity_at`. |
| Changement de mot de passe par l'admin | **Interdit** | Faille + responsabilité juridique. L'admin peut seulement : envoyer un lien de réinitialisation, révoquer toutes les sessions. |

---

## 3. Arborescence

```
flutter-plateforme/
├── CLAUDE.md               ← ce fichier
├── progress.md             ← plan d'exécution, à cocher au fur et à mesure
├── docker-compose.yml      ← postgres + api + web en dev
├── .env.example            ← toutes les variables, valeurs factices
├── api/                    ← Django
│   ├── config/             ← settings/{base,dev,prod}.py, urls, asgi
│   ├── apps/
│   │   ├── accounts/       ← User, sessions, auth, reset
│   │   ├── enrollment/     ← Enrollment, PaymentProof, validation admin
│   │   ├── catalog/        ← Course, Module, Chapter, Lesson
│   │   ├── learning/       ← Progress, attempts, déblocage
│   │   ├── assessment/     ← Question, Choice, Quiz, Exam, scoring
│   │   ├── media/          ← intégration Bunny, signature de tokens
│   │   ├── certification/  ← Certificate, vérification publique
│   │   └── audit/          ← AuditLog
│   ├── tests/
│   └── pyproject.toml
└── web/                    ← Next.js
    ├── app/
    │   ├── (marketing)/    ← landing, prix, démos, chapitre gratuit
    │   ├── (student)/app/  ← parcours, lecteur, QCM
    │   ├── (admin)/admin/  ← back-office
    │   └── api/            ← BFF : proxy des cookies, jamais de logique métier
    ├── components/
    ├── lib/
    └── styles/
```

Règle : **aucun appel direct du navigateur vers Django.** Le navigateur parle aux Route Handlers Next (`/app/api/...`), qui rattachent le cookie httpOnly et appellent Django côté serveur. Django n'est pas exposé publiquement en production.

---

## 4. Sécurité — section non négociable

> C'est le point le plus important du projet. Une formation payante piratée le premier jour n'a plus de business derrière. Toute étape qui échoue un contrôle de cette section est **bloquée**, quel que soit l'état du reste.

### 4.1 Protection du contenu vidéo (priorité maximale)

1. **Aucune URL de fichier vidéo ne transite jamais vers le client.** Le client demande `POST /api/lessons/{id}/playback`, le serveur vérifie les droits, puis renvoie une URL Bunny signée.
2. **Token de lecture** : TTL **5 minutes**, signé côté serveur, lié à `(user_id, lesson_id, ip_prefix)`. Expiré = non rejouable. Jamais de token généré côté client.
3. **Restriction Bunny** : referrer allow-list sur le domaine de production uniquement, direct-play désactivé, DRM/token auth activé dans le pull zone.
4. **Watermark dynamique obligatoire** : superposition affichée par-dessus la vidéo contenant `nom + 4 derniers chiffres du téléphone + horodatage`. Opacité 12–18 %, **position qui change toutes les 20 s** parmi 6 ancrages, `pointer-events: none`, injectée par le composant lecteur. Si le DOM du watermark est supprimé ou masqué (MutationObserver + IntersectionObserver), le lecteur se met en pause et redemande un token.
5. **Session unique** : un seul token de lecture actif par compte. Une nouvelle demande depuis un autre appareil invalide la précédente et incrémente `concurrent_play_attempts`.
6. **Détection de partage** : compteur par utilisateur sur 24 h. Seuils : >40 tokens/h, >3 empreintes d'appareil distinctes sur 7 jours, ou >2 préfixes IP par heure → `flagged_for_review = true` + entrée dans `AuditLog`. On **ne bloque jamais automatiquement**, on remonte à l'admin (un faux positif qui coupe l'accès d'un client payant coûte plus cher qu'un partage).
7. Téléchargement désactivé sur le player (`controlsList="nodownload"`, clic droit neutralisé). C'est cosmétique et on le sait — ça n'excuse pas de sauter les points 1 à 6.

### 4.2 Authentification et sessions

- Hachage **Argon2id** (`PASSWORD_HASHERS` avec Argon2 en tête). Jamais PBKDF2 par défaut.
- Tokens en cookies **httpOnly, Secure, SameSite=Strict**. `localStorage` et `sessionStorage` sont interdits pour tout ce qui est authentification.
- Access token 15 min, refresh 7 jours **rotatif avec détection de réutilisation** : un refresh rejoué invalide toute la famille de tokens.
- Rate limit : 5 tentatives de connexion / 15 min / compte **et** 20 / 15 min / IP. Réinitialisation de mot de passe : 3 / heure.
- **Pas d'énumération d'utilisateurs** : connexion, inscription et reset renvoient le même message et le même temps de réponse, que le compte existe ou non.
- Réinitialisation : token à usage unique, TTL 30 min, invalidé après usage, et **révocation de toutes les sessions** au changement de mot de passe.
- L'admin n'a **aucune route** permettant de définir le mot de passe d'un tiers. Si une telle route apparaît dans une PR, elle est supprimée.

### 4.3 Autorisation

- **Deny by default.** `DEFAULT_PERMISSION_CLASSES = [IsAuthenticated]` dans les settings, chaque vue publique déclare explicitement `AllowAny`.
- Contrôle **au niveau de l'objet** sur chaque endpoint qui prend un id. Jamais « l'utilisateur est authentifié donc il peut lire cette ressource ».
- Le statut admin ne vient **jamais** du client. Aucun champ `role`, `is_admin` ou `is_staff` accepté en entrée d'un serializer.
- Chaque étape doit inclure un test IDOR : l'étudiant A tente d'accéder aux ressources de l'étudiant B (progression, preuve de paiement, tentative de QCM, certificat) → 404, pas 403 (ne pas confirmer l'existence).

### 4.4 Contenu et QCM

- **Les bonnes réponses ne quittent jamais le serveur** avant soumission. Le serializer de question expose `id` et `text` des choix, rien d'autre. La correction est intégralement côté Django.
- L'API de contenu renvoie **un chapitre à la fois**. Jamais l'arbre complet de la formation avec les contenus.
- Le chapitre gratuit (Module 0 / Chapitre 1) est le **seul** contenu accessible sans `Enrollment.status == ACTIVE`. Cette exception est définie par un flag `is_free` en base, pas par un id codé en dur.
- Anti-triche QCM minimal : le serveur stocke l'heure de début de tentative, refuse une soumission plus rapide qu'un seuil plancher, et limite le nombre de tentatives par examen.

### 4.5 Téléversement des preuves de paiement

- Validation par **magic bytes** (`python-magic`), pas par extension ni par le `Content-Type` déclaré. Autorisé : JPEG, PNG, PDF. Rien d'autre. **SVG explicitement interdit.**
- Taille max 5 Mo. Réencodage systématique de l'image (Pillow) pour **détruire l'EXIF** et tout payload embarqué.
- Stockage dans un bucket **privé**, hors racine web, nom de fichier généré (UUID), jamais le nom fourni par l'utilisateur.
- Consultation par l'admin uniquement via **URL signée TTL 10 min**, et chaque consultation est journalisée.
- Une preuve de paiement contient un numéro de CCP : c'est une donnée personnelle sensible. Chiffrement au repos, purge automatique **90 jours après validation**.

### 4.6 Configuration et infrastructure

- `DEBUG = False` en production, `ALLOWED_HOSTS` explicite, `SECRET_KEY` depuis l'environnement uniquement.
- En-têtes : HSTS (1 an, preload), CSP stricte (`default-src 'self'`, la frame Bunny en allow-list explicite), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- CORS : liste blanche d'origines. `CORS_ALLOW_ALL_ORIGINS` est interdit, y compris en développement.
- Aucun secret dans le dépôt. `.env` dans `.gitignore` dès le premier commit.
- Les journaux ne contiennent jamais : mots de passe, tokens, cookies, URLs signées, contenu des preuves de paiement.
- `AuditLog` pour toute action admin : validation de paiement, blocage de compte, publication de contenu, consultation de preuve. Immuable, jamais supprimable depuis l'interface.

---

## 5. Modèle de données (référence)

```
User(email unique, phone, password, is_active, is_staff, last_activity_at,
     flagged_for_review, created_at)
Session(user, refresh_family, device_fingerprint, ip_prefix, revoked_at)

Enrollment(user, course, status[PENDING|ACTIVE|BLOCKED|EXPIRED],
           activated_at, activated_by, note_admin)
PaymentProof(enrollment, file_key, amount_declared, status[SUBMITTED|ACCEPTED|REJECTED],
             reviewed_by, reviewed_at, reject_reason, purge_after)

Course(slug, title, description, is_published)
Module(course, order, title, summary, exam)
Chapter(module, order, title, is_free, lesson, quiz)
Lesson(video_provider_id, duration_s, transcript, resources)

Progress(user, chapter, state[NOT_STARTED|IN_PROGRESS|DONE], watched_s, completed_at)
ModuleCompletion(user, module, exam_passed, best_score, passed_at)

Quiz(chapter|null, module|null, pass_threshold, max_attempts, min_duration_s)
Question(quiz, order, text, explanation)
Choice(question, text, is_correct)          ← is_correct JAMAIS sérialisé
Attempt(user, quiz, started_at, submitted_at, score, answers_jsonb)

Certificate(user, course, code_public, issued_at, revoked_at)
AuditLog(actor, action, target_type, target_id, metadata_jsonb, created_at)
PlaybackToken(user, lesson, issued_at, expires_at, ip_prefix, consumed)
```

---

## 6. Direction visuelle

Applique le skill **frontend-design** à chaque écran. Ce qui suit est le brief ; ne le remplace pas par des valeurs par défaut.

**Sujet et audience.** Formation dev pour étudiants et jeunes développeurs algériens, majoritairement sur mobile Android, souvent en connexion moyenne. L'interface doit avoir l'air d'un **outil de développeur soigné**, pas d'un cours en ligne générique ni d'un jeu pour enfants. Le contenu réel (code Dart, captures d'écran d'émulateur, terminal) est le matériau visuel.

**Palette** — 5 valeurs, définies en tokens CSS, aucune autre couleur autorisée sans raison :
```
--paper   #FAFAF7   fond
--ink     #14201E   texte principal, vert-noir profond (pas un noir neutre)
--zellige #0E6E63   primaire : liens, boutons, état « terminé »
--safran  #E0A22B   réservé exclusivement à la progression et à l'étape courante
--muted   #6E7B78   texte secondaire, bordures
--danger  #B4342A   erreurs et destructif uniquement
```
Le safran ne sert **jamais** de décoration. S'il apparaît quelque part, ça veut dire « c'est ici que tu en es ».

**Typographie** — deux familles nettement distinctes, plus une mono fonctionnelle :
- Titres : **Bricolage Grotesque** (variable, largeurs serrées sur les gros titres)
- Corps : **Public Sans**, 16 px minimum, longueur de ligne < 72 caractères
- Code : **JetBrains Mono**, **uniquement pour du vrai code**. Jamais pour des étiquettes, des badges ou des métadonnées.

Interdits explicites : eyebrows en majuscules espacées au-dessus des titres, un seul mot coloré dans un titre, `→` collé au texte des boutons, méta jointes par des points médians, cartes arrondies identiques pour tout.

**Hero de la landing.** Pas de gros chiffre avec label. Le héros, c'est **le chapitre gratuit qui joue directement dans la page**, avec le parcours complet visible en dessous, les modules verrouillés en grisé. La preuve d'abord, l'argumentaire ensuite.

**Le parcours (pipeline).** Chemin vertical en serpentin, nœud par chapitre, groupé par module. Quatre états visuels :
- `terminé` : rempli en zellige, coche
- `en cours` : anneau safran, seul élément animé de la page
- `disponible` : contour ink, fond paper
- `recommandé plus tard` : opacité 45 %, **reste cliquable**, tooltip « Passe d'abord l'examen du module 2 »

Un seul moment de mouvement dans toute l'app : la transition du nœud vers l'état terminé. Pas d'apparition en fondu sur chaque section, pas de transition au survol sur chaque carte.

**Plancher de qualité, non négociable.** Responsive à partir de 360 px, focus clavier visible partout, `prefers-reduced-motion` respecté, contraste AA, tout l'écran étudiant utilisable au clavier.

**Copie.** Français, tutoiement, phrases courtes. Un bouton dit ce qu'il fait (« Envoyer le reçu », pas « Soumettre »), et le message de succès reprend le même verbe. Les erreurs disent quoi corriger, elles ne s'excusent pas.

---

## 7. Conventions de code

**Django**
- Serializers explicites, champs listés un par un. `fields = '__all__'` est interdit.
- Logique métier dans `apps/<app>/services.py`, pas dans les vues ni les serializers.
- Toute transition d'état (validation de paiement, complétion de module, délivrance de certificat) est dans une transaction atomique.
- Migrations relues avant application. Jamais de `--fake` pour contourner un souci.
- `ruff` + `mypy` en mode strict sur `apps/`.

**Next.js**
- Server Components par défaut. `"use client"` seulement pour le lecteur, les QCM et les formulaires.
- Aucun `fetch` direct vers Django depuis un composant client.
- Zod pour valider toute réponse d'API avant usage — le front ne fait jamais confiance à la forme des données.
- Tailwind avec les tokens du §6 en variables CSS. Pas de valeurs hexadécimales en dur dans les composants.
- `eslint` + `tsc --noEmit` sans erreur. `any` interdit.

**Git**
- Une branche par étape de `progress.md` : `etape-04-lecteur-video`.
- Commits conventionnels (`feat:`, `fix:`, `sec:`).
- Rien n'est mergé sur `main` tant que les trois sous-agents du §8 ne sont pas passés au vert.

---

## 8. Contrôle obligatoire de fin d'étape

À la fin de **chaque** étape de `progress.md`, lancer les trois sous-agents ci-dessous. C'est obligatoire, même pour une étape qui semble triviale. Chacun produit un rapport dans `docs/reviews/etape-XX-<agent>.md`.

### Agent 1 — `code-reviewer`
> Tu es relecteur senior. Tu ne corriges rien, tu documentes. Vérifie : respect de CLAUDE.md §7, logique métier hors des vues, absence de duplication, nommage, gestion d'erreurs et cas limites, migrations cohérentes, absence de code mort ou de TODO laissés. Classe chaque remarque en BLOQUANT / MAJEUR / MINEUR.

### Agent 2 — `code-tester`
> Tu es ingénieur QA. Écris et exécute les tests manquants. Couverture minimale : chemin nominal, chemin d'erreur, et cas limite pour chaque endpoint et chaque composant interactif introduits par l'étape. Cible ≥ 80 % de couverture sur le code de l'étape. Exécute aussi les tests des étapes précédentes pour détecter les régressions. Une étape avec un test rouge est BLOQUÉE.

### Agent 3 — `security-tester` (le plus important)
> Tu es pentesteur, tu es hostile au code. Ton hypothèse par défaut est qu'il est vulnérable. Passe systématiquement sur la checklist ci-dessous, produis des preuves d'exploitation (requêtes curl, extraits de réponses), et classe en CRITIQUE / ÉLEVÉ / MOYEN / FAIBLE.
>
> **Checklist, à repasser intégralement à chaque étape :**
> 1. **IDOR** — depuis le compte de l'étudiant A, tenter d'atteindre chaque ressource de B par id. Progression, tentative de QCM, preuve de paiement, certificat, token de lecture.
> 2. **Fuite de contenu** — inspecter chaque réponse d'API : est-ce qu'un `is_correct`, une URL de vidéo brute, un contenu de chapitre non payé, ou un champ interne s'y trouve ?
> 3. **Escalade de privilèges** — envoyer `is_staff`, `role`, `status`, `enrollment_status` dans les payloads de création et de mise à jour. Aucun ne doit être accepté.
> 4. **Contournement de paywall** — depuis un compte `PENDING`, tenter d'accéder à un chapitre non gratuit par tous les chemins : API directe, route Next, token de lecture, rendu SSR, réponse d'erreur bavarde.
> 5. **Vidéo** — un token est-il rejouable après expiration ? depuis une autre IP ? par un autre utilisateur ? peut-on obtenir l'URL Bunny sans passer par l'endpoint ? le watermark survit-il à une suppression du nœud DOM ?
> 6. **Auth** — énumération d'utilisateurs sur les trois endpoints, rate limiting réellement effectif, rejeu de refresh token, invalidation des sessions au reset, cookies avec les trois flags.
> 7. **Uploads** — téléverser un fichier avec extension `.jpg` et contenu PHP/HTML, un SVG avec script, un polyglotte, un fichier de 100 Mo, un chemin `../../`. Vérifier que le fichier n'est pas accessible sans URL signée.
> 8. **Injection** — SQL via les filtres et les tris, XSS stocké dans tous les champs texte libre (nom, note admin, réponse), XSS dans le rendu des explications de QCM.
> 9. **En-têtes et config** — CSP, HSTS, CORS, `DEBUG`, traces d'exception renvoyées au client, `/admin/` de Django exposé.
> 10. **Journalisation** — un secret, un token ou une URL signée apparaît-il dans les logs ?
>
> Une constatation CRITIQUE ou ÉLEVÉE bloque l'étape. Pas de contournement, pas de « on corrigera plus tard ».

**Règle de sortie d'étape :** l'étape est terminée quand les trois rapports sont écrits, qu'il ne reste aucun BLOQUANT ni CRITIQUE/ÉLEVÉ, et que la case correspondante de `progress.md` est cochée avec la date.

---

## 9. Hors périmètre (ne pas construire)

- Application mobile native. Le web responsive suffit pour la promo 1.
- Chat, forum, messagerie interne. La communauté vit sur Telegram/Discord.
- Correction manuelle de devoirs, upload de photos de résultats.
- Statut de présence en ligne, WebSockets.
- Système de badges, streaks, classements, XP.
- Multi-formateurs, multi-tenant, marketplace.
- Paiement automatique (Chargily) avant l'étape 12.
- Internationalisation. Français uniquement, contenu des slides en anglais simple.

Si une de ces fonctionnalités est demandée en cours de route, la signaler comme hors périmètre et demander confirmation avant de coder.

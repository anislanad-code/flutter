# Étape 04 — Rapport de test

**Date** : 2026-09-04
**Branche** : `etape-04-lecteur-video`
**Agent** : `code-tester` (CLAUDE.md §8, agent 2)

Aucun code de production n'a été modifié. Un test rouge aurait été laissé rouge.

## Environnement

| Composant | Version |
|---|---|
| Exécution | Docker Compose (`api`, `web`, `db`) |
| Python | 3.12.14 |
| Django / DRF | 5.2.17 / 3.18.0 |
| PostgreSQL | 16.14 (Alpine, base réelle, jamais SQLite) |
| Node / npm | 22.23.2 / 10.9.8 |
| Next.js | 15.5.25 |
| Vitest / Testing Library | 5.0.0 / React Testing Library |

## Commandes exécutées

```
docker compose exec -T api pytest --cov=apps --cov=config --cov-report=term-missing --cov-fail-under=80
docker compose exec -T web npm run test
docker compose exec -T web npm run test:cov
```

## Inventaire des unités introduites par l'étape

| Unité | Type | Couverte par |
|---|---|---|
| `POST /api/lessons/{id}/playback` | endpoint | `media/tests/test_endpoints`, `test_partage` |
| `POST /api/playback/{id}/heartbeat` | endpoint | `media/tests/test_endpoints` |
| `emettre_jeton` / `battement` / `_verifier_partage` | services | `test_endpoints`, `test_partage`, `test_domaine` |
| `signer_url_lecture` / `ip_pour_signature` | signature Bunny | `media/tests/test_signing` |
| `PlaybackToken` + admin Django lecture seule | modèle | `media/tests/test_domaine` |
| `position_de` / `enregistrer_position` / `Progress` | learning | `learning/tests/test_position` |
| `LessonSerializer` sans `video_provider_id` | serializer | `test_endpoints`, `catalog/tests` |
| `User.concurrent_play_attempts` | compteur §4.1.5 | `test_endpoints` |
| `rediger_secrets` URLs CDN | logging | `tests/test_logging_et_mail` |
| Settings `BUNNY_*` / `PLAYBACK_*` | config | `test_endpoints`, `test_partage` |
| BFF `/api/lessons/[id]/playback` | route handler | `playback-routes` |
| BFF `/api/playback/[id]/heartbeat` | route handler | `playback-routes` |
| `LecteurSecurise` | composant | `lecteur-securise` |
| `LecteurChapitre` | composant | `composants-marketing`, `marketing-cas-limites` |
| `filigrane.ts` | lib | `filigrane` |
| `playback-schemas.ts` | lib | `playback-schemas`, `playback-routes` |
| Middleware Bunny CSP + cookie `device` | middleware | `middleware` |

Chemins exercés par unité (nominal / erreur / limite) :

| Unité | Nominal | Erreur | Limite |
|---|---|---|---|
| playback | anonyme gratuit, ACTIVE payant | 404 anonyme/PENDING/non publié, 503 Bunny, 429 | leçon sans vidéo, `is_staff` ignoré, empreinte vide |
| heartbeat | `watched_s` enregistré et repris | 404 autre compte / autre IP / expiré / inconnu / compte vs anonyme | sans `watched_s`, négatif, > 86400, anonyme ignore la position |
| partage | flag + accès conservé | — | double journalisation, empreintes vides exclues, rate limit |
| LecteurSecurise | jeton BFF + filigrane | 404, 503, throw, hors schéma, HLS absent | heartbeat 404 → autre appareil + Reprendre ici, filigrane retiré, intersection |

## Tests ajoutés

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `api/apps/media/tests/test_endpoints.py` | Empreinte vide = concurrent ; compte ≠ jeton anonyme ; heartbeat sans `watched_s` ; bornes serializer ; hôte Bunny vide ; téléphone court | 10 |
| `api/apps/media/tests/test_domaine.py` | `__str__` sans URL ; `est_actif` ; libellé filigrane ; 404 muet ; admin sans add/change | 5 |
| `api/apps/media/tests/test_partage.py` | Empreintes vides exclues du seuil 7 j | 1 |
| `api/apps/media/tests/test_signing.py` | Préfixe `https://`, hôte vide, id avec query, IPv4 brute | 4 |
| `api/apps/learning/tests/test_position.py` | `__str__` de Progress ; `duration_s=0` et `watched_s` négatif | 2 |
| `api/tests/test_logging_et_mail.py` | URL `*.iframe.mediadelivery.net` masquée | 1 |
| `web/tests/lecteur-securise.test.tsx` | Fetch qui throw, 503, hors schéma, chargement, heartbeat 404 + Reprendre ici, battement inactif, HLS natif/absent, intersection, ancrage, refresh jeton | 13 |
| `web/tests/playback-routes.test.ts` | 429 / 503 / 401=404 / Django down / cookie device déjà posé ; heartbeat corps vide, 404, 503, 502 | 9 |
| `web/tests/filigrane.test.ts` | collapse, rgba transparent, clip rect, brightness 0, taille nulle, opacity/police non numériques | 2 |
| `web/tests/playback-schemas.test.ts` | https only, reprise négative, battement incomplet | 5 |
| `web/tests/middleware.test.ts` | Cookie device déjà posé ; hostname CDN avec schéma/chemin | 2 |

**Total ajouté dans cette passe QA : 54 cas** (23 backend, 31 frontend).

## Résultats

### Backend — suite complète (étapes 0, 1, 2, 3 et 4)

```
497 passed in 22.49s

Name                                                    Stmts   Miss  Cover   Missing
-------------------------------------------------------------------------------------
apps/media/admin.py                                        15      0   100%
apps/media/models.py                                       21      0   100%
apps/media/serializers.py                                  18      0   100%
apps/media/services.py                                    144      0   100%
apps/media/signing.py                                      47      0   100%
apps/media/views.py                                        47      0   100%
apps/learning/models.py                                    19      0   100%
apps/learning/services.py                                  24      0   100%
apps/catalog/serializers.py                                42      0   100%
apps/accounts/models.py                                    52      0   100%
config/logging_filters.py                                  16      0   100%
apps/enrollment/views.py                                  118      1    99%   72
-------------------------------------------------------------------------------------
TOTAL                                                    1917      1    99%
```

Couverture globale **99,95 %** (`--cov-fail-under=80` vert).

### Frontend — suite complète (étapes 0, 1, 2, 3 et 4)

```
Test Files  32 passed (32)
      Tests  457 passed (457)
```

Couverture Vitest (`npm run test:cov`) : **98,77 % statements, 100 % lines** sur `app/`, `lib/`, `components/`, `middleware.ts`.

Fichiers de l'étape 4 (tous à 100 % de lignes) :

| Fichier | Lignes |
|---|---|
| `app/api/lessons/[id]/playback/route.ts` | 100 % |
| `app/api/playback/[id]/heartbeat/route.ts` | 100 % |
| `components/course/LecteurSecurise.tsx` | 100 % |
| `components/course/LecteurChapitre.tsx` | 100 % |
| `lib/filigrane.ts` | 100 % |
| `lib/playback-schemas.ts` | 100 % |
| `lib/auth-cookie-names.ts` | 100 % |
| `middleware.ts` | 100 % |

## Couverture

Cible ≥ 80 % sur le code de l'étape : **atteinte** (100 % backend sur `apps.media`, `apps.learning`, settings playback / filtres CDN / `LessonSerializer` / `concurrent_play_attempts` ; 100 % des lignes frontend de l'étape).

Trous signalés en entrée, tous productibles et maintenant couverts :

| Trou | Test |
|---|---|
| `services.py` empreinte vide (~140) | `test_sans_empreinte_un_rafraichissement_compte_comme_concurrent` |
| compte qui bat un jeton anonyme (~306-308) | `test_un_compte_ne_reprend_pas_un_jeton_anonyme` |
| heartbeat sans `watched_s` (~322) | `test_heartbeat_sans_watched_s_renvoie_la_position_connue` |
| `admin.py` has_add / has_change | `test_l_admin_django_interdit_d_ajouter_ou_modifier_un_jeton` |
| `__str__` Progress / PlaybackToken | `test_str_de_progress_identifie_user_et_chapitre`, `test_str_du_jeton_ne_contient_pas_d_url` |
| heartbeat 404 → autre appareil | `passe sur un autre appareil si le heartbeat répond 404` |
| bouton « Reprendre ici » | `reprend ici après un heartbeat 404` |
| fetch qui throw | `affiche un écran générique si le fetch lève` |

Ligne backend hors étape : `apps/enrollment/views.py:72` (étape 3, `CONTENT_LENGTH` déjà couvert ailleurs). Non bloquant.

Branches frontend restantes (lignes 100 %, non bloquantes) :

- `LecteurSecurise.tsx` : `ANCRAGES[(i+1)%n] ?? "tl"` (le `??` est mort : le tableau est complet) ; heartbeat `!ok` non-404 et JSON hors schéma (le tick ignore et continue)
- `middleware.ts:16` : hostname CDN vide après trim (déjà le défaut de test sans `BUNNY_CDN_HOSTNAME`)

Observation (pas un test rouge) : `_URL_CDN` exige un préfixe avant `iframe.mediadelivery.net`. Une URL `https://iframe.mediadelivery.net/...` (hostname nu) n'est **pas** masquée. Le motif couvre `https://player.iframe.mediadelivery.net/...` et `*.b-cdn.net`. À signaler au security-tester, pas un échec de cette porte QA.

## Invariantes §4 rejouées (étapes 0–3, toujours vertes)

- Aucun serializer n'expose `is_correct`
- Aucune URL de fichier vidéo brute dans une réponse (`video_provider_id` absent du chapitre, URL signée seulement via playback)
- Un compte `PENDING` n'obtient que le chapitre `is_free` (404 identique à l'inexistant)
- Cookies d'auth : `httpOnly` + `SameSite=Strict` (`Secure` en production)
- Aucune route ne permet de définir le mot de passe d'un tiers

## Régressions détectées

Aucune. La suite des étapes 0, 1, 2 et 3 est incluse dans les 497 tests backend et les 457 tests frontend ; tout est vert.

## Tests rouges (= étape bloquée)

Aucun.

## Verdict

**PORTE OUVERTE**

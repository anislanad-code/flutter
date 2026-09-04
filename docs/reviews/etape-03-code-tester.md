# Étape 03 — Rapport de test

**Date** : 2026-09-04
**Branche** : `etape-03-inscription-payante`
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
docker compose exec -T api pytest --cov=apps --cov=config --cov-report=term-missing -q
docker compose exec -T web npm run test
docker compose exec -T web npm run test:cov
```

## Inventaire des unités introduites par l'étape

| Unité | Type | Couverte par |
|---|---|---|
| `POST /api/enrollment/proof` | endpoint | `test_endpoints_etudiant` |
| `GET /api/enrollment/status` | endpoint | `test_endpoints_etudiant` |
| `GET /api/admin/enrollments` | endpoint | `test_endpoints_admin` |
| `POST /api/admin/enrollments/{id}/accept` | endpoint | `test_endpoints_admin` |
| `POST /api/admin/enrollments/{id}/reject` | endpoint | `test_endpoints_admin` |
| `GET /api/admin/proofs/{id}/url` | endpoint | `test_endpoints_admin` |
| `GET /api/admin/proofs/{id}/file` | endpoint | `test_endpoints_admin` |
| `GET /api/chapters/{slug}` (paywall) | endpoint | `test_paywall` |
| `creer_inscription_initiale` / `deposer_preuve` / `accepter_inscription` / `refuser_preuve` / `purger_preuves_echues` | services | `test_services`, `test_purge` |
| `assainir_preuve` | pipeline §4.5 | `test_files` |
| `LocalEncryptedProofStorage` | stockage | `test_storage` |
| `signer` / `verifier` | signature TTL 10 min | `test_signing` |
| `ManualCCPProvider` / emails / admin Django | domaine | `test_domaine` |
| `AuditLog` immuable | audit | `test_audit_log` |
| `PAYMENT_PROOF_ENCRYPTION_KEY` courte (prod) | config | `test_settings_config` |
| BFF `/api/enrollment/*` et `/api/admin/*` | route handlers | `enrollment-routes` |
| `FormulaireRecu` / `InstructionsVersement` / `ParcoursEtudiant` / `FileInscriptions` | composants | `enrollment-composants` |
| `/app`, `/app/activation`, `/app/chapitre/[chapitre]`, `/admin/inscriptions` | pages | `enrollment-pages` |
| `lib/enrollment`, `enrollment-schemas`, `session-headers` | libs | `lib-enrollment` |

## Tests ajoutés

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `api/apps/enrollment/tests/test_files.py` | Erreurs image productibles : JPEG tronqué, PNG RGBA, PDF `/JS` et `/AA`, PDF sans `%PDF-`, image > 50 Mpx sous le seuil Pillow, `convert()` qui lève | 7 |
| `api/apps/enrollment/tests/test_services.py` | Inscription existante (idempotence), `course=None` (0 / 2 formations publiées), dépôt qui crée ou rattache le cours, motif vide au service, atomicité (échec `journaliser` → aucun effet partiel), fichier disparu / signature invalide | 21 |
| `api/apps/enrollment/tests/test_domaine.py` | `donne_acces_au_contenu`, `est_lisible`, `__str__` sans `file_key`, admin Django lecture seule sur les preuves, CCP via l'interface, emails sans token ni URL signée | 6 |
| `api/apps/enrollment/tests/test_endpoints_etudiant.py` | `CONTENT_LENGTH` invalide → 400, 5 Mo pile (serializer), 413 après lecture, PDF via l'endpoint, méthodes 405, `course_slug` nul, création d'inscription au `GET /status` | 7 |
| `api/apps/enrollment/tests/test_endpoints_admin.py` | 409 accept déjà couvert ; 409 reject (sans reçu et rejeu), 404 reject, note d'acceptation, `expires` non numérique, fichier disparu, `course_title` nul, POST sur la file | 10 |
| `api/tests/test_settings_config.py` | Prod refuse une clé de chiffrement courte ou vide, et un `PAYMENT_PROOF_STORAGE_DIR` absent | 3 |
| `api/apps/enrollment/tests/test_storage.py` | Mode `0o600` sur l'objet chiffré | 1 |
| `api/apps/audit/tests/test_audit_log.py` | `__str__` ne fuit pas une signature | 1 |
| `web/tests/enrollment-composants.test.tsx` | Chargement, aperçu image/PDF, erreur réseau, message générique, montant saisi, clavier, fichier retiré, `EXPIRED`, file sans reçu, téléphone vide | 13 |
| `web/tests/enrollment-routes.test.ts` | Content-Length 413, fichier vide, 409/401/503 dépôt, formData illisible, 502/503 file, 409/404 accept/reject, aperçu 503/404/charset | 23 |
| `web/tests/enrollment-pages.test.tsx` | Activation `BLOCKED`, tableau de bord `EXPIRED` / état injoignable, filtre `ACTIVE`, file admin nulle | 5 |
| `web/tests/lib-enrollment.test.ts` | 400 / hors schéma côté lectures serveur, chapitre hors schéma | 3 |

**Total ajouté dans cette passe QA : 100 cas** (56 backend, 44 frontend).

## Résultats

### Backend — suite complète (étapes 0, 1, 2 et 3)

```
423 passed in 22.63s

Name                                                    Stmts   Miss  Cover   Missing
-------------------------------------------------------------------------------------
apps/accounts/...                                         ...      0   100%
apps/audit/...                                            ...      0   100%
apps/catalog/...                                          ...      0   100%
apps/enrollment/admin.py                                   20      0   100%
apps/enrollment/emails.py                                  12      0   100%
apps/enrollment/files.py                                   61      0   100%
apps/enrollment/models.py                                  54      0   100%
apps/enrollment/permissions.py                             14      0   100%
apps/enrollment/providers.py                               24      0   100%
apps/enrollment/serializers.py                             67      0   100%
apps/enrollment/services.py                               150      0   100%
apps/enrollment/signing.py                                 20      0   100%
apps/enrollment/storage.py                                 47      0   100%
apps/enrollment/views.py                                  118      0   100%
apps/enrollment/management/commands/purger_preuves.py       9      0   100%
config/settings/prod.py                                    20      0   100%
-------------------------------------------------------------------------------------
TOTAL                                                    1504      0   100%
```

### Frontend — suite complète (étapes 0, 1, 2 et 3)

```
Test Files  28 passed (28)
      Tests  401 passed (401)
```

Couverture Vitest (`npm run test:cov`) : **99,49 % statements, 100 % lines** sur `app/`, `lib/`, `components/`, `middleware.ts`.

Fichiers de l'étape 3 (tous à 100 % de lignes) :

| Fichier | Lignes |
|---|---|
| `app/api/enrollment/proof/route.ts` | 100 % |
| `app/api/enrollment/status/route.ts` | 100 % |
| `app/api/admin/enrollments/route.ts` | 100 % |
| `app/api/admin/enrollments/[id]/accept/route.ts` | 100 % |
| `app/api/admin/enrollments/[id]/reject/route.ts` | 100 % |
| `app/api/admin/proofs/[id]/apercu/route.ts` | 100 % |
| `components/enrollment/FormulaireRecu.tsx` | 100 % |
| `components/enrollment/InstructionsVersement.tsx` | 100 % |
| `components/student/ParcoursEtudiant.tsx` | 100 % |
| `components/admin/FileInscriptions.tsx` | 100 % |
| `app/(student)/app/page.tsx` | 100 % |
| `app/(student)/app/activation/page.tsx` | 100 % |
| `app/(student)/app/chapitre/[chapitre]/page.tsx` | 100 % |
| `app/(admin)/admin/inscriptions/page.tsx` | 100 % |
| `lib/enrollment.ts` | 100 % |
| `lib/enrollment-schemas.ts` | 100 % |
| `lib/session-headers.ts` | 100 % |

## Couverture

Cible ≥ 80 % sur le code de l'étape : **atteinte** (100 % backend `apps` + `config` ; 100 % des lignes frontend, dont 100 % sur chaque module de l'étape 3).

Trous signalés en entrée, tous productibles et maintenant couverts :

| Trou | Test |
|---|---|
| `files.py` erreurs image | JPEG tronqué, `convert()` OSError, > 50 Mpx, PNG RGBA |
| `views.py` `CONTENT_LENGTH` invalide | `test_un_content_length_invalide_est_refuse_en_400` |
| `views.py` 409 accept/reject | accept déjà là ; reject sans reçu + rejeu |
| `services.py` inscription existante | `test_creer_inscription_initiale_est_idempotente` |
| `services.py` `course None` | 0 / 2 formations publiées ; dépôt qui rattache |
| `prod.py` clé courte | `test_la_production_refuse_une_cle_de_chiffrement_courte` |

Branches frontend restantes (lignes 100 %, branches partielles, non bloquantes) :

- `proof/route.ts` : `amount_declared` non-chaîne (le BFF force `""`)
- `apercu/route.ts:69` : `contentType.split(";")[0]` vide (`?? ""` mort : `split` rend toujours un élément)
- `FormulaireRecu.tsx:83` : branche `typeof detail === "string"` déjà exercée par le refus 400 ; v8 signale un partiel

Ces branches ne se déclenchent pas dans un flux HTTP réel sans mentir au runtime. Pas de code de production touché pour les forcer.

## Invariantes §4 rejouées (étapes 0–2, toujours vertes)

- Aucun serializer n'expose `is_correct`
- Aucune URL de fichier vidéo brute dans une réponse
- Un compte `PENDING` n'obtient que le chapitre `is_free` (404 identique à l'inexistant)
- Cookies d'auth : `httpOnly` + `SameSite=Strict` (`Secure` en production)
- Aucune route ne permet de définir le mot de passe d'un tiers

## Régressions détectées

Aucune. La suite des étapes 0, 1 et 2 est incluse dans les 423 tests backend et les 401 tests frontend ; tout est vert.

## Tests rouges (= étape bloquée)

Aucun.

## Verdict

**PORTE OUVERTE**

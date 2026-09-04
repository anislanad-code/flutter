# Étape 05 — Rapport de test

**Date** : 2026-09-04
**Branche** : `claude/etape-05-lecteur-video-71fc9n`
**Agent** : `code-tester` (CLAUDE.md §8, agent 2)

Aucun code de production n'a été modifié. Deux fichiers de test ont été ajoutés, deux
fichiers de test existants complétés, et **un test rouge intermittent de l'étape 4 a été
corrigé** (défaut de test, pas de bug produit — diagnostic détaillé plus bas).

## Environnement

| Composant | Version |
|---|---|
| Exécution | Locale (`uv` + `npm`), PostgreSQL du poste |
| Python | 3.12.3 |
| Django / DRF | 5.x / DRF (voir `uv.lock`) |
| PostgreSQL | 16 (cluster `16/main`, base réelle `anisdev`, jamais SQLite) |
| Node / Vitest | Node 22 / Vitest 5.0.0 |
| Next.js | 15.5.x |

## Commandes exécutées

```
# Backend (depuis api/, DJANGO_SETTINGS_MODULE=config.settings.dev)
uv sync --extra dev
uv run pytest -q
uv run pytest apps/learning --cov=apps/learning --cov-report=term-missing
uv run pytest --cov=apps --cov=config --cov-report=term-missing
uv run ruff check .
uv run ruff format --check .
uv run mypy apps config

# Frontend (depuis web/)
npm run lint
npx tsc --noEmit
npm test
npm run test:cov
```

## Inventaire des unités introduites par l'étape

| Unité | Type | Couverte par |
|---|---|---|
| `GET /api/progress?course=<slug>` | endpoint | `learning/tests/test_views`, `test_soft_gating` |
| `POST /api/chapters/{slug}/complete` | endpoint | `learning/tests/test_views`, `test_soft_gating` |
| `calculer_pipeline` | service | `test_services`, `test_soft_gating` |
| `terminer_chapitre` | service (atomique, idempotent) | `test_services`, `test_soft_gating` |
| `_etat_chapitre` (4 états du §6) | service | `test_services` |
| `PipelineSerializer` / `ChapterStateSerializer` | serializers | `test_views`, `test_soft_gating` |
| `ModuleCompletion` (+ migration, admin) | modèle | `test_soft_gating` |
| `Pipeline` / `NoeudPipeline` | composants | `pipeline-composants`, `pipeline-accessibilite` |
| `BoutonTerminerChapitre` | composant client | `pipeline-composants`, `pipeline-accessibilite` |
| BFF `POST /api/chapters/[slug]/complete` | route handler | `chapter-complete-route` |
| `lib/progress.ts`, `lib/progress-schemas.ts` | lib | `lib-progress` |
| `/app` (rendu du pipeline, `?termine=`) | page serveur | `enrollment-pages` |
| `globals.css` (animation + reduced-motion) | CSS | `pipeline-accessibilite` |

Chemins exercés par endpoint (nominal / non authentifié / autorisé mais pas habilité /
payload invalide / 404 / cas limite) :

| Endpoint | Nominal | Non auth | Paywall | 404 | Cas limite |
|---|---|---|---|---|---|
| `GET /api/progress` | pipeline complet 2 modules | 401 | compte `PENDING` : titres seulement, aucun contenu | cours inconnu, cours dépublié, **sans paramètre `course`** | module vide (0/0), formation sans module, params `?user=` ignorés |
| `POST /chapters/{slug}/complete` | 200 + idempotence | 401 | `PENDING` sur chapitre payant → 404 (pas 403) | slug inconnu, cours dépublié | 429 au 31ᵉ appel, chapitre sans leçon, corps forgé `{"user": B}` ignoré |

## Tests ajoutés

| Fichier | Ce qu'il prouve | Cas |
|---|---|---|
| `api/apps/learning/tests/test_soft_gating.py` *(nouveau)* | Les cinq critères « Terminé quand » de l'étape 5 côté serveur : soft gating sans aucun 403, persistance au rechargement et au changement d'appareil, IDOR en lecture et en écriture, invariantes de fuite, cas limites du calcul | 20 |
| `web/tests/pipeline-accessibilite.test.tsx` *(nouveau)* | Navigation clavier complète, focus visible, unique animation de complétion et son pilotage, `prefers-reduced-motion`, cas limites d'affichage, état de chargement du bouton | 20 |
| `web/tests/enrollment-pages.test.tsx` *(complété)* | Recalcul serveur à chaque rendu (`force-dynamic`), `?termine=` purement cosmétique et non forgeable, aucun contenu de chapitre dans le pipeline | 4 |

**Total ajouté : 44 cas** (20 backend, 24 frontend).

### Détail des trous comblés

Les tests déjà présents couvraient bien le chemin nominal et la structure de réponse.
Les manques réels portaient sur les critères d'acceptation eux-mêmes :

1. **Soft gating jamais 403** — aucun test ne vérifiait qu'un compte `ACTIVE` peut
   *terminer* un chapitre d'un module encore `recommande_plus_tard`. C'est le premier
   critère de l'étape. Trois tests l'établissent, dont un balayage complet
   (`test_aucun_endpoint_du_pipeline_ne_renvoie_403_sur_un_compte_actif`) qui affirme
   `set(codes) == {200}` sur les six appels possibles.
2. **IDOR** — les tests existants montraient que deux comptes ne partagent pas leur
   état, mais personne n'avait tenté de *forcer* la lecture ou l'écriture vers un tiers.
   Ajouté : cinq noms de paramètres plausibles sur `GET /api/progress`, un corps forgé
   sur `POST .../complete`, et la preuve que terminer un chapitre n'écrase pas la
   progression d'un autre compte sur le même chapitre.
3. **Persistance** — aucun test ne vérifiait qu'une session ouverte depuis un autre
   appareil (autre empreinte, autre préfixe IP) voit exactement le même pipeline.
4. **Clavier et focus** — le Pipeline n'avait aucun test d'accessibilité. Ajouté :
   tous les nœuds sont des `<a>` sans `tabindex`, sans `aria-disabled`, sans
   `pointer-events-none` ; l'ordre de tabulation suit le parcours ; le nœud
   « recommandé plus tard » prend le focus comme les autres ; le marqueur visuel est
   `aria-hidden` et l'état reste lisible en texte.
5. **`prefers-reduced-motion`** — le CSS n'était couvert par rien. Trois tests lisent
   `app/globals.css` et vérifient que la media query neutralise `animation-duration`,
   `animation-iteration-count` et `transition-duration`, qu'il n'existe **qu'une seule**
   règle `animation:` dans toute la feuille (§6 : un seul moment de mouvement), et que
   `:focus-visible` pose un contour sans jamais `outline: none`.
6. **Cas limites du calcul** — module sans chapitre (0/0 sans division par zéro ni
   `NaN`), formation sans module, chapitre publié sans leçon (`duration_s` absent),
   `ModuleCompletion.__str__` (les deux seules lignes non couvertes du backend).

## Résultats

### Backend — suite complète (étapes 0 à 5)

```
541 passed in 59.73s
```

```
All checks passed!                          (ruff check)
131 files already formatted                 (ruff format --check)
Success: no issues found in 136 source files (mypy strict)
```

### Frontend — suite complète (étapes 0 à 5)

```
Test Files  36 passed (36)
      Tests  510 passed (510)
```

```
> eslint .            → aucune erreur
> tsc --noEmit        → aucune erreur
```

## Couverture

### Backend — code de l'étape 5 (`apps/learning`)

```
Name                           Stmts   Miss  Cover   Missing
------------------------------------------------------------
apps/learning/__init__.py          0      0   100%
apps/learning/admin.py            13      0   100%
apps/learning/apps.py              4      0   100%
apps/learning/models.py           30      0   100%
apps/learning/serializers.py      25      0   100%
apps/learning/services.py         99      0   100%
apps/learning/urls.py              4      0   100%
apps/learning/views.py            42      0   100%
------------------------------------------------------------
TOTAL                            217      0   100%
```

**100 %** sur le code de l'étape (99 % avant cette passe : `models.py:70-71`,
`ModuleCompletion.__str__`, désormais couvert).

Couverture globale du backend : **99 %** (2091 instructions, 1 non couverte —
`apps/enrollment/views.py:72`, héritée de l'étape 3 et déjà documentée).

### Frontend — code de l'étape 5

```
Statements   : 98.18% ( 1136/1157 )
Branches     : 96.47% ( 740/767 )
Functions    : 95.55% ( 172/180 )
Lines        : 99.62% ( 1058/1062 )
```

| Fichier de l'étape 5 | Stmts | Branch | Lines |
|---|---|---|---|
| `components/student/Pipeline.tsx` | 100 % | **100 %** | 100 % |
| `components/student/NoeudPipeline.tsx` | 100 % | **100 %** | 100 % |
| `components/course/BoutonTerminerChapitre.tsx` | 100 % | 100 % | 100 % |
| `app/api/chapters/[slug]/complete/route.ts` | 100 % | 100 % | 100 % |
| `lib/progress.ts` | 100 % | 100 % | 100 % |
| `lib/progress-schemas.ts` | 100 % | 100 % | 100 % |
| `app/(student)/app/page.tsx` | 100 % | 100 % | 100 % |

Avant cette passe, `Pipeline.tsx` était à 92,85 % de branches (ligne 46 : le module à
`total_chapters === 0`) et `NoeudPipeline.tsx` à 85,71 % (ligne 23 : la classe
d'animation). Les deux branches sont désormais exercées.

**Lignes non couvertes qui comptent (hors étape 5)** : `LecteurSecurise.tsx:70-73`
(étape 4, branche de reprise du minuteur natif — déjà relevée dans le rapport de
l'étape 4) et quelques branches défensives de `lib/api.ts`, `lib/client-ip.ts`,
`lib/filigrane.ts`. Rien sur le périmètre de l'étape 5.

## Régressions détectées

Aucune régression fonctionnelle : les 521 tests backend et 486 tests frontend des
étapes 0 à 4 passent tous après l'étape 5.

**Un test rouge intermittent a en revanche été trouvé et corrigé.**

`web/tests/lecteur-securise.test.tsx > LecteurSecurise > redemande un jeton avant
expiration` échouait environ 1 exécution sur 10 lorsque la machine est chargée :

```
 FAIL  tests/lecteur-securise.test.tsx > LecteurSecurise > redemande un jeton avant expiration
AssertionError: expected 1 to be greater than 1
 ❯ tests/lecteur-securise.test.tsx:364:52
    363|     await waitFor(() => {
    364|       expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(avant);
       |                                                 ^
```

**Diagnostic : défaut de test, pas de bug produit.** Le test intercepte les
`setTimeout` de plus de 5 s pour déclencher manuellement le renouvellement de jeton,
mais il n'attendait que l'apparition de l'élément `<video>` avant d'appeler
`captures[0]?.()`. Le minuteur est armé dans un effet qui peut s'exécuter après ce
rendu ; sous charge, `captures` était encore vide, l'appel optionnel devenait un
no-op et l'assertion échouait. Le code de production est correct — il arme bien le
minuteur, ce que prouve le fait que le test passe dès qu'on attend sa capture.

Correction appliquée (fichier de test uniquement) :

```ts
await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
/* Le minuteur de renouvellement est armé dans un effet, qui peut passer après le
   rendu de la vidéo : on attend qu'il soit réellement capturé, sinon l'appel plus
   bas est un coup dans le vide et le test échoue au hasard (machine chargée). */
await waitFor(() => expect(captures.length).toBeGreaterThan(0));
```

Vérification : **12 exécutions consécutives de la suite complète sous charge CPU
concurrente, 12 vertes** (avant correction : 1 échec sur 10 dans les mêmes conditions).

> Note méthodologique : une campagne intermédiaire lancée avec `vitest run --no-isolate`
> a produit des échecs massifs et bruyants. Ils ne sont **pas** représentatifs : la suite
> repose sur des `vi.mock` hoistés par fichier, qui ne peuvent pas fonctionner quand les
> workers sont partagés. Le mode par défaut (`isolate: true`) est le seul supporté, et
> ces résultats ont été écartés.

## Tests rouges (= étape bloquée)

Aucun. Les 541 tests backend et 510 tests frontend sont verts, y compris après
12 réexécutions sous charge.

## Verdict

**PORTE OUVERTE.**

Les cinq critères « Terminé quand » de l'étape 5 sont désormais chacun couverts par au
moins un test dédié :

- [x] Aucun endpoint ne renvoie 403 pour un chapitre non terminé sur un compte `ACTIVE`
      — `test_aucun_endpoint_du_pipeline_ne_renvoie_403_sur_un_compte_actif`
- [x] L'état du pipeline survit à un rechargement et à un changement d'appareil
      — `test_letat_du_pipeline_survit_a_un_rechargement`,
        `test_letat_du_pipeline_survit_a_un_changement_dappareil`,
        « l'état du pipeline est redemandé au serveur à chaque rendu »
- [x] Navigation complète au clavier avec focus visible
      — describe « Pipeline — navigation clavier » (5 cas) + `:focus-visible` dans `globals.css`
- [x] `prefers-reduced-motion` désactive l'animation de complétion
      — describe « invariantes visuelles du §6 dans globals.css »
- [x] L'étudiant A ne peut pas lire ni modifier la progression de B
      — describe « IDOR » (3 cas) + `test_progression_dun_etudiant_nest_jamais_visible_pour_un_autre`

Invariantes du §4 rejouées et vertes : aucun `is_correct` ni URL vidéo dans les réponses
du pipeline, un compte `PENDING` n'obtient rien d'autre que des titres et des états,
aucune route ne prend d'identifiant d'utilisateur, aucun `localStorage`/`sessionStorage`
dans `web/`.

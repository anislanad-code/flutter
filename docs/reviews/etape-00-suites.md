# Étape 0 — Suites données aux trois rapports

Date : 2026-09-03 · Branche `etape-00-fondations`

Les trois rapports (`etape-00-code-reviewer.md`, `etape-00-code-tester.md`,
`etape-00-security-tester.md`) sont laissés intacts : ils décrivent le code tel qu'il était
au moment de la porte. Ce fichier dit ce qui a été fait de chaque constatation.

---

## Bloquants et sévérités hautes — tous corrigés

| Réf | Constatation | Correction | Preuve |
|---|---|---|---|
| SEC-C1 | **CVE-2025-29927** : `x-middleware-subrequest` désactive le middleware de Next 15.1.6 — plus de CSP, et à l'étape 1 plus de protection de `/app` et `/admin`. | Next porté à **15.5.25**. `postcss` forcé en 8.5.28 par `overrides` (Next embarquait 8.4.31), `vitest`/`@vitest/coverage-v8` portés en 5.0.0, `@types/node` en ^22. | `npm audit` : **0 vulnérabilité**, prod et dev. Requête forgée sur un `next start` : la CSP est bien présente. |
| SEC-E1 | Le `matcher` du middleware s'excluait sur `next-router-prefetch` et `purpose: prefetch`, deux en-têtes que le client pose lui-même. `curl -H "purpose: prefetch" /` renvoyait le document sans CSP. | Les conditions `missing` sont supprimées : le matcher est une simple chaîne. | `curl` avec chacun des deux en-têtes : CSP présente. Test `ne conditionne sa portée à aucun en-tête de requête`. |
| SEC-E2 | `DJANGO_ADMIN_PATH=` (présent mais vide, la forme d'une ligne `.env` en blanc) montait l'admin Django à la racine : `GET /%2Flogin/` renvoyait le formulaire de connexion. | `base.py` normalise (`strip("/ ")`) et refuse une valeur vide ; `prod.py` refuse en plus la valeur `admin`. | 5 tests, dont `""`, `"   "`, `"/"`, `" / "` et `"admin"`. |
| REV-B1 / SEC-M1 | `.gitignore` contenait `media/` sans ancrage : la règle destinée aux téléversements avalait `api/apps/media/`. Un clone n'avait que 7 applications sur 8 et ne démarrait pas. | Règles ancrées : `/api/media/`, `/api/staticfiles/`. L'application est ajoutée au dépôt. | `git ls-files "api/apps/*/apps.py"` → **8**. |
| REV-B2 / QA-B1 | La CSP à nonce tuait la page en production : `next build` prérendait `/` en statique, donc sans nonce, et `'strict-dynamic'` annule `'self'` — tous les scripts bloqués. Invisible en `next dev`. | Le layout racine lit le nonce via `headers()`, ce qui bascule le rendu en dynamique et fait tamponner ses scripts par Next. | Build : plus aucune route `○ (Static)`. Sur `next start` : **0 script sans `nonce=`**. La CI échoue si une route redevient statique. |

---

## Majeurs — corrigés

- **`apiFetch` perdait les en-têtes.** `...init.headers` réduisait à rien une instance `Headers`
  ou un tableau de paires — le cookie de session de l'étape 1 ne serait jamais parti. Remplacé par
  `new Headers(init.headers)`. Test dédié.
- **`API_INTERNAL_URL` acceptait n'importe quel schéma.** `z.url()` laissait passer `ftp://`,
  `file://`, `javascript:`. Borné à `http`/`https`. Le test qui *constatait* le défaut a été
  retourné en test qui l'*interdit*.
- **Le BFF confondait « API injoignable » et « base tombée ».** `apiFetch` gagne un
  `acceptStatuses` explicite ; seule la sonde s'en sert, pour le 503. Par défaut aucun corps
  d'erreur de Django ne remonte — l'invariante de non-fuite est conservée et testée.
- **La sonde se disait « ok » en répondant 503.** Le corps dit maintenant `degraded`. Vérifié de
  bout en bout : `docker compose stop db` → `{"status":"down","api":"ok","db":"down"}` en 503.
- **La page de référence dupliquait les jetons et annonçait des valeurs fausses** (`4rem` alors que
  le jeton est passé en `clamp()`). Les jetons vivent dans `web/lib/design-tokens.ts` ; 19 tests
  comparent cette description à `styles/tokens.css` et échouent à la moindre dérive.
- **La CI était aveugle là où le bloquant s'est glissé.** Elle gagne : seuil de couverture
  (`--cov-fail-under=80`), `manage.py check --deploy --fail-level WARNING` sur les **réglages de
  production** (jamais chargés jusqu'ici), un contrôle qu'aucune route n'est prérendue en statique,
  et un job qui construit les deux images Docker.
- **Un test entérinait un défaut**, et un autre était tautologique (il mockait un échec, cas où la
  route renvoie un littéral figé). Tous deux réécrits pour exercer le chemin nominal.

---

## Mineurs — corrigés

`--bordure` (jeton mort) supprimé · `next lint` déprécié remplacé par `eslint .` · HSTS et
`upgrade-insecure-requests` ne sont plus émis en développement · reliquats de `create-next-app`
supprimés (favicon par défaut, `web/.gitignore` en doublon, SVG de démonstration) et remplacés par
une vraie favicon de marque, dont les couleurs sont elles aussi testées contre la palette · la mono
ne sert plus pour des étiquettes (§6) · les couleurs en `style={{…}}` passent par les classes
Tailwind adossées aux jetons · `docker-compose` : `API_INTERNAL_URL` n'est plus défini deux fois,
`api` a un `healthcheck` et `web` l'attend en `service_healthy` · `.gitignore` : plus de `/*.png`
attrape-tout.

**`DJANGO_SETTINGS_MODULE` n'est plus forcé dans `docker-compose.yml`** (SEC-M3) : un bloc
`environment:` l'emporte sur `env_file:`, et c'était le chemin par lequel un déploiement serait
retombé en réglages de développement.

**Django porté de 5.1.5 à 5.2.17** (SEC-M4), la branche LTS ; 5.1 est sortie du support. DRF en
3.18.0, `django-cors-headers` en 4.9.0, stubs et mypy alignés.

---

## Assumé, avec la raison

- **SEC-M2 — le 404 de Django en `DEBUG` divulgue l'URLconf.** C'est le comportement de Django en
  développement, et `DEBUG=False` est vérifié en production par un test et par `check --deploy`.
- **SEC-M5 — `style-src 'unsafe-inline'`.** Nécessaire à Next et Tailwind aujourd'hui. La
  constatation est réelle et sérieuse : elle permettrait de neutraliser visuellement le watermark
  du §4.1 sans toucher au DOM, donc sans réveiller le `MutationObserver`. **Reporté à l'étape 4**,
  où le watermark existera : il faudra un observateur de style calculé, pas seulement de DOM.
- **REV-MINEUR 2 — la sonde est publique, sans limitation, et ouvre une requête SQL par appel.**
  Le rate limiting arrive à l'étape 1 ; la sonde y sera incluse.
- **REV-MINEUR 3 — `DJANGO_ADMIN_PATH` vaut `admin` par défaut dans `base.py`.** Un défaut est
  nécessaire pour le développement. Le garde-fou est en production, où la valeur est exigée,
  normalisée, et refusée si elle vaut `admin`.

---

## État après remédiation

| Contrôle | Résultat |
|---|---|
| `ruff check` · `ruff format --check` | vert |
| `mypy --strict` (34 fichiers) | vert |
| `pytest --cov` | **49 tests**, **100 %** |
| `manage.py check --deploy` sur `settings.prod` | 0 problème |
| `eslint .` · `tsc --noEmit` | vert |
| `vitest --coverage` | **98 tests**, 100 % des instructions |
| `next build` | vert, **aucune route statique** |
| `npm audit` (prod et dev) | **0 vulnérabilité** |
| Parcours manuel | `/api/health` en 200 ; base éteinte → 503 `db: down` ; base relancée → 200 |

**Ce qui reste ouvert :** la CI n'a jamais tourné, faute de remote GitHub. Tant qu'un push ne l'a
pas fait passer au vert, le quatrième critère du « Terminé quand » de l'étape 0 n'est pas coché.

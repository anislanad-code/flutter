# Étape 3 — Suites données aux trois rapports

Date : 2026-09-04 · Branche `etape-03-inscription-payante`

Les trois rapports (`etape-03-code-reviewer.md`, `etape-03-code-tester.md`,
`etape-03-security-tester.md`) sont laissés intacts : ils décrivent le code tel qu'il était
au moment de la porte. Ce fichier dit ce qui a été fait de chaque constatation.

---

## Bloquants et sévérités hautes — tous corrigés

| Réf | Constatation | Correction | Preuve |
|---|---|---|---|
| REV-B1 | `ruff check` / `ruff format --check` / `mypy apps config` rouges (imports, format des tests, `unreachable` sur `donne_acces_au_contenu`). | Tests reformatés ; `donne_acces_au_contenu` vérifié sur des instances construites avec le `status` voulu, sans mutation en mémoire. | `ruff check` · `ruff format --check` · `mypy apps config` : vert. |
| SEC-E1 | `GET /api/admin/proofs/{id}/file?expires=&signature=` : HMAC et expiration dans les access logs Django. | Le chemin émis n'a plus de query string. Signature et expiration voyagent en `X-Proof-Expires` / `X-Proof-Signature`. Un GET recopié depuis un log historique → 404. Filtre `RedactSecretsFilter` en défense en profondeur. | Test `une_signature_en_query_string_est_ignoree`. BFF : Zod exige `path === /file` exact, puis pose les en-têtes. |
| SEC-E2 | Backend console imprimait le jeton de reset en clair dans stdout ; pentest : prise de contrôle du compte A. | `config.mail.RedactingConsoleEmailBackend` masque `token=` / `signature=`. Défaut de `dev.py` et `.env.example`. | Test `le_backend_console_n_imprime_pas_le_jeton`. Runtime : `EMAIL_BACKEND=config.mail.RedactingConsoleEmailBackend`. |

---

## Majeurs — corrigés

- **Admin Django hors pipeline.** `EnrollmentAdmin` : pas d'ajout, pas de suppression, `status` / `user` / `course` / `activated_*` en lecture seule (`note_admin` reste le filet). `PaymentProofAdmin.has_delete_permission = False`. Tests dédiés.
- **Plafond 5 Mo avant la vue.** `PlafondPreuveMiddleware` coupe un `CONTENT_LENGTH` déclaré trop grand en 413, y compris sans session. Le reverse-proxy (`client_max_body_size`) reste l'étape 10.
- **Timeout 8 s sur Pillow.** `apiFetch` / `apiFetchBinaire` acceptent `timeoutMs`. Dépôt et aperçu : 60 s. Test `honore un timeoutMs plus long que le défaut`.
- **Signature dans les journaux.** Voir SEC-E1. Le BFF ne suit plus un `path` qui porte une query string.
- **« CCP » hors adaptateur.** Titre d'activation et bannière `/app` lisent `instructions.account_label`. Tests avec `CIB` / `BaridiMob`.
- **Clé d'exemple acceptée en prod.** `prod.py` refuse la valeur de `.env.example`, exige `COURSE_PRICE_DZD > 0` et des coordonnées de versement. CI `check --deploy` alignée.

---

## Moyens — un corrigé, deux assumés

- **SEC-M3 — CSP `sandbox` de l'aperçu écrasée.** Le matcher du middleware exclut `api/admin/proofs/`. La route pose `default-src 'none'; sandbox` et elle survit.
- **SEC-M1 — `X-Forwarded-For` pris à gauche.** Même constat qu'à l'étape 2. `proof:user` (10/h) reste le filet par compte. Hop de confiance : reverse-proxy, étape 10.
- **SEC-M2 — le BFF parse le corps avant de lire `Content-Length`.** Django coupe dès que l'en-tête est honnête. Un 100 Mo annoncé au BFF occupe encore un worker Next tant qu'il n'y a pas de plafond HTTP en bord. **Étape 10.**

---

## Mineurs — assumés, avec la raison

- **Unicité `(user, course)` inopérante si `course` est NULL.** Promo 1 a une formation seedée. Contrainte partielle le jour où le catalogue peut être vide.
- **Emails `fail_silently=True`.** Même geste qu'`accounts`. File d'envoi à l'étape 9 ; d'ici là un échec SMTP n'annule pas une validation déjà commitée.
- **`opacity-45` vs contraste AA.** Tension déjà notée à l'étape 2 sur le parcours marketing ; le §6 prescrit les deux. Arbitrage reporté avec le serpentin de l'étape 5.
- **Constante 5 Mo recopiée BFF / client.** Django reste la source de vérité ; BFF et formulaire ne font qu'un refus précoce. Un 413 du serveur dit quoi corriger.

---

## État après remédiation

| Contrôle | Résultat |
|---|---|
| `ruff check` · `ruff format --check` | vert |
| `mypy apps config` | vert |
| `pytest` | **434 passed** |
| `eslint` · `tsc --noEmit` | vert |
| `vitest run` | **404 passed** |

**Il ne reste aucun BLOQUANT ni CRITIQUE/ÉLEVÉ.**

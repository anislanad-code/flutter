import "server-only";

import { serverEnv } from "@/lib/env";

/* Seul point de contact avec Django. Appelé uniquement depuis des Server Components
   et des Route Handlers : le navigateur ne parle jamais directement à l'API (§3). */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export type ApiOptions = {
  /** Statuts non-2xx dont le corps est exploitable et que l'appelant revalide lui-même.
      Sans cette liste, un corps d'erreur de Django n'est jamais relayé : il peut
      contenir une trace, un nom de table ou un détail interne. */
  readonly acceptStatuses?: readonly number[];
  /** Contenu public et non personnalisé (catalogue, landing) : mis en cache ce nombre
      de secondes plutôt que refait à chaque requête. Absent = `no-store`, le défaut
      sûr pour tout ce qui dépend d'un cookie de session. */
  readonly revalidateSeconds?: number;
};

const TIMEOUT_MS = 8_000;

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: ApiOptions = {},
): Promise<ApiResult<T>> {
  const { API_INTERNAL_URL } = serverEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // `new Headers` plutôt qu'un étalement d'objet : `init.headers` peut être une
    // instance `Headers` ou un tableau de paires, que `...` aurait silencieusement
    // réduits à rien. À l'étape 1 c'est le cookie de session qui y transitera.
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_INTERNAL_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
      ...(options.revalidateSeconds !== undefined
        ? { next: { revalidate: options.revalidateSeconds } }
        : { cache: "no-store" }),
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok && !options.acceptStatuses?.includes(response.status)) {
      return { ok: false, status: response.status, error: "api_error" };
    }

    return { ok: true, status: response.status, data: body as T };
  } catch {
    // On ne relaie jamais le message d'erreur brut : il peut contenir l'URL interne.
    return { ok: false, status: 503, error: "api_unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

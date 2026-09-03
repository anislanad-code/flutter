import "server-only";

import { serverEnv } from "@/lib/env";

/* Seul point de contact avec Django. Appelé uniquement depuis des Server Components
   et des Route Handlers : le navigateur ne parle jamais directement à l'API (§3). */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

const TIMEOUT_MS = 8_000;

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const { API_INTERNAL_URL } = serverEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_INTERNAL_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
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

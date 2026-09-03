import "server-only";

import { cookies } from "next/headers";

import { apiFetch } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/auth-cookie-names";
import { utilisateurSchema, type Utilisateur } from "@/lib/auth-schemas";

/** À utiliser dans les Server Components de `/app` et `/admin`. */
export async function utilisateurCourant(): Promise<Utilisateur | null> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!accessToken) return null;

  const result = await apiFetch<unknown>(
    "/api/me",
    { headers: { Cookie: `access_token=${accessToken}` } },
    { acceptStatuses: [401] },
  );
  if (!result.ok || result.status === 401) return null;

  const parsed = utilisateurSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

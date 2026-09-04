import "server-only";

import { apiFetch } from "@/lib/api";
import {
  chapitreGratuitSchema,
  chapitreSchema,
  coursPublicSchema,
  type Chapitre,
  type ChapitreGratuit,
  type CoursPublic,
} from "@/lib/catalog-schemas";
import { enTetesSession } from "@/lib/session-headers";

/* Contenu public, sans cookie : mis en cache 5 minutes plutôt que refait à chaque
   requête (Lighthouse, charge serveur). À utiliser seulement dans des Server
   Components ou des Route Handlers — jamais un fetch direct depuis le navigateur (§7). */
const REVALIDATE_SECONDS = 300;

export const SLUG_FORMATION_PRINCIPALE = "flutter-firebase-debutants";

export async function recupererCours(slug: string): Promise<CoursPublic | null> {
  const result = await apiFetch<unknown>(
    `/api/public/course/${slug}`,
    {},
    { acceptStatuses: [404], revalidateSeconds: REVALIDATE_SECONDS },
  );
  if (!result.ok || result.status === 404) return null;

  const parsed = coursPublicSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

export async function recupererChapitreGratuit(slug: string): Promise<ChapitreGratuit | null> {
  const result = await apiFetch<unknown>(
    `/api/public/chapters/${slug}`,
    {},
    { acceptStatuses: [404], revalidateSeconds: REVALIDATE_SECONDS },
  );
  if (!result.ok || result.status === 404) return null;

  const parsed = chapitreGratuitSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

/** Chapitre servi à un compte connecté. Django ne le renvoie que s'il est gratuit ou
 *  si l'inscription est `ACTIVE` — sinon 404, exactement comme un chapitre inexistant
 *  (§4.4). Jamais de cache : la réponse dépend du compte qui la demande. */
export async function recupererChapitreAuthentifie(slug: string): Promise<Chapitre | null> {
  const headers = await enTetesSession();
  if (!headers) return null;

  const result = await apiFetch<unknown>(
    `/api/chapters/${encodeURIComponent(slug)}`,
    { headers },
    { acceptStatuses: [401, 404] },
  );
  if (!result.ok || result.status !== 200) return null;

  const parsed = chapitreSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

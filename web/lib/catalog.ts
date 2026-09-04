import "server-only";

import { apiFetch } from "@/lib/api";
import {
  chapitreGratuitSchema,
  coursPublicSchema,
  type ChapitreGratuit,
  type CoursPublic,
} from "@/lib/catalog-schemas";

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

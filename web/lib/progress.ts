import "server-only";

import { apiFetch } from "@/lib/api";
import { pipelineSchema, type Pipeline } from "@/lib/progress-schemas";
import { enTetesSession } from "@/lib/session-headers";

/** État du pipeline pour le compte connecté. Jamais de cache : dépend du compte (§7). */
export async function recupererPipeline(
  courseSlug: string,
): Promise<Pipeline | null> {
  const headers = await enTetesSession();
  if (!headers) return null;

  const result = await apiFetch<unknown>(
    `/api/progress?course=${encodeURIComponent(courseSlug)}`,
    { headers },
    { acceptStatuses: [401, 404] },
  );
  if (!result.ok || result.status !== 200) return null;

  const parsed = pipelineSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

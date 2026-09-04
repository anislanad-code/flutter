import "server-only";

import { apiFetch } from "@/lib/api";
import {
  pipelineSchema,
  type ModuleEtat,
  type Pipeline,
} from "@/lib/progress-schemas";
import { enTetesSession } from "@/lib/session-headers";

/** Distingue « pas de session » (rien à charger, ce n'est pas une erreur) de
 *  « la lecture a échoué » (Django injoignable, 401, forme inattendue) — l'appelant ne
 *  doit jamais confondre les deux avec « rien n'a encore été fait » (§6, un incident se
 *  présente à l'étudiant comme un parcours effacé sinon). */
export type ResultatPipeline =
  | { ok: true; pipeline: Pipeline }
  | { ok: false; raison: "sans_session" | "indisponible" };

export async function recupererPipeline(
  courseSlug: string,
): Promise<ResultatPipeline> {
  const headers = await enTetesSession();
  if (!headers) return { ok: false, raison: "sans_session" };

  const result = await apiFetch<unknown>(
    `/api/progress?course=${encodeURIComponent(courseSlug)}`,
    { headers },
    { acceptStatuses: [401, 404] },
  );
  if (!result.ok || result.status !== 200)
    return { ok: false, raison: "indisponible" };

  const parsed = pipelineSchema.safeParse(result.data);
  if (!parsed.success) return { ok: false, raison: "indisponible" };
  return { ok: true, pipeline: parsed.data };
}

/** Le module qui contient `chapterSlug`, ou `null` s'il n'y est pas — utilisé par la
 *  page de chapitre pour savoir si elle doit afficher le bandeau de recommandation. */
export function moduleDuChapitre(
  pipeline: Pipeline,
  chapterSlug: string,
): ModuleEtat | null {
  return (
    pipeline.modules.find((mod) =>
      mod.chapters.some((c) => c.slug === chapterSlug),
    ) ?? null
  );
}

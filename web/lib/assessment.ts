import "server-only";

import { apiFetch } from "@/lib/api";
import { etatQuizSchema, type EtatQuiz } from "@/lib/assessment-schemas";
import { enTetesSession } from "@/lib/session-headers";

/* Même distinction qu'ailleurs (§6) entre « pas de session », « inaccessible » (paywall,
   quiz inexistant) et « le chargement a échoué » — la page ne doit jamais confondre un
   compte qui n'a pas le droit avec un incident technique. */
export type ResultatQuiz =
  | { ok: true; quiz: EtatQuiz }
  | { ok: false; raison: "sans_session" | "inaccessible" | "indisponible" };

export async function recupererQuiz(id: number): Promise<ResultatQuiz> {
  const headers = await enTetesSession();
  if (!headers) return { ok: false, raison: "sans_session" };

  const result = await apiFetch<unknown>(
    `/api/quizzes/${id}`,
    { headers },
    { acceptStatuses: [401, 404, 429] },
  );
  if (!result.ok) return { ok: false, raison: "indisponible" };
  if (result.status === 404) return { ok: false, raison: "inaccessible" };
  if (result.status !== 200) return { ok: false, raison: "indisponible" };

  const parsed = etatQuizSchema.safeParse(result.data);
  if (!parsed.success) return { ok: false, raison: "indisponible" };
  return { ok: true, quiz: parsed.data };
}

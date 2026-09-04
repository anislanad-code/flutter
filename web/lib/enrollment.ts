import "server-only";

import { apiFetch } from "@/lib/api";
import {
  etatInscriptionSchema,
  listeInscriptionsSchema,
  type EtatInscription,
  type InscriptionAdmin,
  type StatutInscription,
} from "@/lib/enrollment-schemas";
import { enTetesSession } from "@/lib/session-headers";

/* Lectures serveur de l'inscription. Jamais de cache : tout ici dépend du cookie de
   session et change à la seconde où l'admin valide un paiement. */

export async function recupererEtatInscription(): Promise<EtatInscription | null> {
  const headers = await enTetesSession();
  if (!headers) return null;

  const result = await apiFetch<unknown>("/api/enrollment/status", { headers }, {
    acceptStatuses: [401, 404],
  });
  if (!result.ok || result.status !== 200) return null;

  const parsed = etatInscriptionSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

export async function recupererInscriptionsAdmin(
  statut?: StatutInscription,
): Promise<InscriptionAdmin[] | null> {
  const headers = await enTetesSession();
  if (!headers) return null;

  const requete = statut ? `?status=${encodeURIComponent(statut)}` : "";
  const result = await apiFetch<unknown>(`/api/admin/enrollments${requete}`, { headers }, {
    acceptStatuses: [400, 401, 404],
  });
  if (!result.ok || result.status !== 200) return null;

  const parsed = listeInscriptionsSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
}

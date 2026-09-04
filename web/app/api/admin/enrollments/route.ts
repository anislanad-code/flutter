import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { listeInscriptionsSchema, statutInscriptionSchema } from "@/lib/enrollment-schemas";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const headers = enTetesSessionDepuis(request);
  if (!headers) {
    return NextResponse.json({ detail: "Session expirée." }, { status: 401 });
  }

  /* Le filtre n'est relayé que s'il fait partie des statuts connus : ce paramètre
     finit dans un `filter()` côté Django, il ne traverse pas le BFF tel quel. */
  const brut = request.nextUrl.searchParams.get("status");
  const statut = statutInscriptionSchema.safeParse(brut);
  const requete = brut === null ? "" : statut.success ? `?status=${statut.data}` : null;
  if (requete === null) {
    return NextResponse.json({ detail: "Statut inconnu." }, { status: 400 });
  }

  const result = await apiFetch<unknown>(`/api/admin/enrollments${requete}`, { headers }, {
    acceptStatuses: [400, 401, 404],
  });

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status !== 200) {
    // 404 = compte non-admin (§4.3 : on ne confirme pas l'existence de la route).
    return NextResponse.json({ detail: "Introuvable." }, { status: result.status });
  }

  const parsed = listeInscriptionsSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  return NextResponse.json(parsed.data, { status: 200 });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { etatInscriptionSchema } from "@/lib/enrollment-schemas";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const headers = enTetesSessionDepuis(request);
  if (!headers) {
    return NextResponse.json({ detail: "Session expirée." }, { status: 401 });
  }

  const result = await apiFetch<unknown>("/api/enrollment/status", { headers }, {
    acceptStatuses: [401, 404],
  });

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status !== 200) {
    return NextResponse.json({ detail: "Session expirée." }, { status: 401 });
  }

  const parsed = etatInscriptionSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  return NextResponse.json(parsed.data, { status: 200 });
}

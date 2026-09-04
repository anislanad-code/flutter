import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

const corpsSchema = z.object({ note: z.string().max(500).optional() });

type Contexte = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, contexte: Contexte): Promise<NextResponse> {
  const headers = enTetesSessionDepuis(request);
  if (!headers) {
    return NextResponse.json({ detail: "Session expirée." }, { status: 401 });
  }

  const { id } = await contexte.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ detail: "Introuvable." }, { status: 404 });
  }

  const corps = corpsSchema.safeParse(await request.json().catch(() => ({})));
  if (!corps.success) {
    return NextResponse.json({ detail: "Requête invalide." }, { status: 400 });
  }

  const result = await apiFetch<{ detail?: string }>(
    `/api/admin/enrollments/${id}/accept`,
    { method: "POST", body: JSON.stringify({ note: corps.data.note ?? "" }), headers },
    { acceptStatuses: [400, 401, 404, 409] },
  );

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status === 200) {
    return NextResponse.json({ detail: "Inscription validée." }, { status: 200 });
  }
  if (result.status === 409) {
    const detail =
      typeof result.data?.detail === "string"
        ? result.data.detail
        : "Cette inscription n'a aucun reçu à examiner.";
    return NextResponse.json({ detail }, { status: 409 });
  }
  return NextResponse.json({ detail: "Introuvable." }, { status: result.status });
}

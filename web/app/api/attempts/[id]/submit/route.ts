import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import { resultatTentativeSchema } from "@/lib/assessment-schemas";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

/* Validation de forme minimale (§7) : la correction elle-même reste entièrement du
   côté de Django (§4.4) — ce serializer ne fait que refuser un corps qui n'a même pas
   la forme d'une réponse avant de le relayer. */
const corpsSchema = z.object({
  answers: z.record(z.string(), z.number()),
});

export async function POST(
  request: NextRequest,
  contexte: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await contexte.params;
  const headers = enTetesSessionDepuis(request);
  if (!headers) {
    return NextResponse.json({ detail: "Session invalide ou expirée." }, { status: 401 });
  }

  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  if (!corps.success) {
    return NextResponse.json({ detail: "Réponses invalides pour ce QCM." }, { status: 400 });
  }

  const result = await apiFetch<unknown>(
    `/api/attempts/${encodeURIComponent(id)}/submit`,
    { method: "POST", headers, body: JSON.stringify(corps.data) },
    { acceptStatuses: [400, 401, 404, 409, 429] },
  );

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status === 429) {
    return NextResponse.json(
      { detail: "Trop de tentatives. Réessaie plus tard." },
      { status: 429 },
    );
  }
  if (result.status === 401) {
    return NextResponse.json({ detail: "Session invalide ou expirée." }, { status: 401 });
  }
  if (result.status === 404) {
    return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
  }
  if (result.status === 409) {
    const corpsDjango =
      typeof result.data === "object" && result.data !== null && "detail" in result.data
        ? String((result.data as { detail: unknown }).detail)
        : "Cette tentative a déjà été corrigée.";
    return NextResponse.json({ detail: corpsDjango }, { status: 409 });
  }
  if (result.status === 400) {
    const corpsDjango =
      typeof result.data === "object" && result.data !== null && "detail" in result.data
        ? String((result.data as { detail: unknown }).detail)
        : "Réponds un peu plus lentement avant d'envoyer.";
    return NextResponse.json({ detail: corpsDjango }, { status: 400 });
  }
  if (result.status !== 200) {
    return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
  }

  const parsed = resultatTentativeSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  return NextResponse.json(parsed.data, { status: 200 });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
}

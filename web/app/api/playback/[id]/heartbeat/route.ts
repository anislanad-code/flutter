import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { ipDuVisiteur } from "@/lib/client-ip";
import { battementSchema } from "@/lib/playback-schemas";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  contexte: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await contexte.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
  }

  let watched_s: number | undefined;
  try {
    const brut: unknown = await request.json();
    if (
      typeof brut === "object" &&
      brut !== null &&
      "watched_s" in brut &&
      typeof (brut as { watched_s: unknown }).watched_s === "number"
    ) {
      watched_s = (brut as { watched_s: number }).watched_s;
    }
  } catch {
    watched_s = undefined;
  }

  const session = enTetesSessionDepuis(request) ?? {};
  const result = await apiFetch<unknown>(
    `/api/playback/${id}/heartbeat`,
    {
      method: "POST",
      headers: { ...session, "X-Forwarded-For": ipDuVisiteur(request) },
      body: JSON.stringify(watched_s === undefined ? {} : { watched_s }),
    },
    { acceptStatuses: [401, 404] },
  );

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status !== 200) {
    return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
  }

  const parsed = battementSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }
  return NextResponse.json(parsed.data, { status: 200 });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
}

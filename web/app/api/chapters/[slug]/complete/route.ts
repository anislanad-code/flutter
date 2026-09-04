import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { chapitreCompleteSchema } from "@/lib/progress-schemas";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  contexte: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await contexte.params;
  const headers = enTetesSessionDepuis(request);
  if (!headers) {
    return NextResponse.json(
      { detail: "Session invalide ou expirée." },
      { status: 401 },
    );
  }

  const result = await apiFetch<unknown>(
    `/api/chapters/${encodeURIComponent(slug)}/complete`,
    { method: "POST", headers, body: "{}" },
    { acceptStatuses: [401, 404, 429] },
  );

  if (!result.ok) {
    return NextResponse.json(
      { detail: "Service indisponible." },
      { status: 503 },
    );
  }
  if (result.status === 429) {
    return NextResponse.json(
      { detail: "Trop de tentatives. Réessaie plus tard." },
      { status: 429 },
    );
  }
  if (result.status === 401) {
    return NextResponse.json(
      { detail: "Session invalide ou expirée." },
      { status: 401 },
    );
  }
  if (result.status !== 200) {
    return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
  }

  const parsed = chapitreCompleteSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: "Réponse inattendue du serveur." },
      { status: 502 },
    );
  }

  return NextResponse.json(parsed.data, { status: 200 });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import { ipDuVisiteur } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

const corpsSchema = z.object({ token: z.string(), password: z.string() });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  if (!corps.success) {
    return NextResponse.json({ detail: "Requête invalide." }, { status: 400 });
  }

  const result = await apiFetch<unknown>(
    "/api/auth/password-reset/confirm",
    {
      method: "POST",
      body: JSON.stringify(corps.data),
      headers: { "X-Forwarded-For": ipDuVisiteur(request) },
    },
    { acceptStatuses: [400, 429] },
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
  if (result.status === 400) {
    return NextResponse.json(result.data as Record<string, unknown>, { status: 400 });
  }

  return new NextResponse(null, { status: 204 });
}

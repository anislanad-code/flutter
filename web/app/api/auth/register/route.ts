import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import { poserCookiesAuth } from "@/lib/auth-cookies";
import { sessionEmiseSchema } from "@/lib/auth-schemas";
import { ipDuVisiteur } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

const corpsSchema = z.object({
  email: z.string(),
  phone: z.string().optional(),
  password: z.string(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  if (!corps.success) {
    return NextResponse.json({ detail: "Requête invalide." }, { status: 400 });
  }

  const result = await apiFetch<unknown>(
    "/api/auth/register",
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

  const parsed = sessionEmiseSchema.safeParse(result.data);
  if (!parsed.success) {
    // Cas normal : email déjà pris (§4.2, pas d'énumération) — même statut, sans session.
    return NextResponse.json(
      { detail: "Compte créé si l'email était disponible. Connecte-toi pour continuer." },
      { status: 201 },
    );
  }

  const reponse = NextResponse.json({ user: parsed.data.user }, { status: 201 });
  poserCookiesAuth(reponse, parsed.data);
  return reponse;
}

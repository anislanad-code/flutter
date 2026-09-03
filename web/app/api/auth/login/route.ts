import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import { poserCookiesAuth } from "@/lib/auth-cookies";
import { sessionEmiseSchema } from "@/lib/auth-schemas";
import { ipDuVisiteur } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

const corpsSchema = z.object({ email: z.string(), password: z.string() });

const MESSAGE_INVALIDE = "Email ou mot de passe incorrect.";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  if (!corps.success) {
    return NextResponse.json({ detail: MESSAGE_INVALIDE }, { status: 401 });
  }

  const result = await apiFetch<unknown>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify(corps.data),
      headers: { "X-Forwarded-For": ipDuVisiteur(request) },
    },
    { acceptStatuses: [401, 429] },
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
    return NextResponse.json({ detail: MESSAGE_INVALIDE }, { status: 401 });
  }

  const parsed = sessionEmiseSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  const reponse = NextResponse.json({ user: parsed.data.user }, { status: 200 });
  poserCookiesAuth(reponse, parsed.data);
  return reponse;
}

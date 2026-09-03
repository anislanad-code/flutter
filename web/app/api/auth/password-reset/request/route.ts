import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import { ipDuVisiteur } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

const corpsSchema = z.object({ email: z.string() });

const MESSAGE = "Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const corps = corpsSchema.safeParse(await request.json().catch(() => null));
  if (!corps.success) {
    return NextResponse.json({ detail: MESSAGE });
  }

  await apiFetch<unknown>("/api/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify(corps.data),
    headers: { "X-Forwarded-For": ipDuVisiteur(request) },
  });

  // Réponse identique quoi qu'il arrive côté Django : ne jamais confirmer/infirmer (§4.2).
  return NextResponse.json({ detail: MESSAGE });
}

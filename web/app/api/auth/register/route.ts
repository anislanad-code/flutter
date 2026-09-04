import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";
import { ipDuVisiteur } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

const corpsSchema = z.object({
  email: z.string(),
  phone: z.string().optional(),
  password: z.string(),
});

const MESSAGE_GENERIQUE = "Compte créé si l'email était disponible. Connecte-toi pour continuer.";

/* Django ne connecte jamais automatiquement à l'inscription : une réponse qui varie
   selon que le compte existait déjà (avec ou sans tokens) est un oracle d'énumération
   à elle seule, même à statut identique (§4.2 — constaté ÉLEVÉ par la porte de
   sécurité de l'étape 1). Cette route relaie donc toujours la même réponse générique
   et ne pose jamais de cookie ; c'est `POST /api/auth/login`, appelé séparément par le
   formulaire avec les mêmes identifiants, qui connecte réellement l'utilisateur — et
   qui est lui-même déjà audité pour ne rien révéler sur l'existence du compte. */
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

  return NextResponse.json({ detail: MESSAGE_GENERIQUE }, { status: 201 });
}

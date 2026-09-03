import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { effacerCookiesAuth, poserCookiesAuth, REFRESH_COOKIE } from "@/lib/auth-cookies";
import { sessionEmiseSchema } from "@/lib/auth-schemas";
import { ipDuVisiteur } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ detail: "Session invalide ou expirée." }, { status: 401 });
  }

  const result = await apiFetch<unknown>(
    "/api/auth/refresh",
    {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      headers: { "X-Forwarded-For": ipDuVisiteur(request) },
    },
    { acceptStatuses: [401, 429] },
  );

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status !== 200) {
    const reponse = NextResponse.json(
      { detail: "Session invalide ou expirée." },
      { status: result.status === 429 ? 429 : 401 },
    );
    if (result.status !== 429) effacerCookiesAuth(reponse);
    return reponse;
  }

  const parsed = sessionEmiseSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  const reponse = NextResponse.json({ user: parsed.data.user }, { status: 200 });
  poserCookiesAuth(reponse, parsed.data);
  return reponse;
}

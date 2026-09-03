import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { ACCESS_COOKIE } from "@/lib/auth-cookies";
import { utilisateurSchema } from "@/lib/auth-schemas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Non authentifié." }, { status: 401 });
  }

  const result = await apiFetch<unknown>(
    "/api/me",
    { headers: { Cookie: `access_token=${accessToken}` } },
    { acceptStatuses: [401] },
  );

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status === 401) {
    return NextResponse.json({ detail: "Non authentifié." }, { status: 401 });
  }

  const parsed = utilisateurSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  return NextResponse.json(parsed.data);
}

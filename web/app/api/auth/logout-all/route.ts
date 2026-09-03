import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { ACCESS_COOKIE, effacerCookiesAuth } from "@/lib/auth-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Non authentifié." }, { status: 401 });
  }

  const result = await apiFetch<unknown>("/api/auth/logout-all", {
    method: "POST",
    headers: { Cookie: `access_token=${accessToken}` },
  });

  const reponse = new NextResponse(null, { status: result.ok ? 204 : result.status });
  effacerCookiesAuth(reponse);
  return reponse;
}

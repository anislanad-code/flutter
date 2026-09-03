import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { effacerCookiesAuth, REFRESH_COOKIE } from "@/lib/auth-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value ?? "";

  // Best-effort : les cookies du navigateur sont effacés même si Django est injoignable.
  await apiFetch<unknown>("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const reponse = new NextResponse(null, { status: 204 });
  effacerCookiesAuth(reponse);
  return reponse;
}

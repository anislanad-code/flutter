import "server-only";

import type { NextResponse } from "next/server";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth-cookie-names";

/* Cookies httpOnly posés par le BFF (CLAUDE.md §4.2). Django ne parle jamais au
   navigateur : les tokens transitent en JSON entre Next et Django (voir lib/api.ts),
   et c'est ici, uniquement, qu'ils deviennent des cookies pour le navigateur. */

export { ACCESS_COOKIE, REFRESH_COOKIE };

const estProd = process.env.NODE_ENV === "production";

export function poserCookiesAuth(
  reponse: NextResponse,
  tokens: {
    access_token: string;
    access_token_expires_in: number;
    refresh_token: string;
    refresh_token_expires_in: number;
  },
): void {
  const base = {
    httpOnly: true,
    secure: estProd,
    sameSite: "strict" as const,
    path: "/",
  };
  reponse.cookies.set(ACCESS_COOKIE, tokens.access_token, {
    ...base,
    maxAge: tokens.access_token_expires_in,
  });
  reponse.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
    ...base,
    maxAge: tokens.refresh_token_expires_in,
  });
}

export function effacerCookiesAuth(reponse: NextResponse): void {
  reponse.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  reponse.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
}

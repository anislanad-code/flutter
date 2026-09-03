import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/* CSP à nonce (CLAUDE.md §4.6).
   Next injecte des scripts inline pour le streaming RSC : sans nonce, une CSP stricte
   casse la page. On génère donc un nonce par requête plutôt que d'ouvrir 'unsafe-inline'.
   La frame Bunny sera ajoutée ici, explicitement, à l'étape 4. */

const estDev = process.env.NODE_ENV === "development";

function politiqueCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' : seuls les scripts porteurs du nonce, et ceux qu'ils chargent.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${estDev ? " 'unsafe-eval'" : ""}`,
    // Next et Tailwind injectent des styles inline ; aucune exécution de code n'en découle.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${estDev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // Inutile en local, et nuisible : forcerait le navigateur à réécrire en https
    // les requêtes vers un poste de développement servi en clair.
    ...(estDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID();
  const csp = politiqueCsp(nonce);

  const enTetesRequete = new Headers(request.headers);
  enTetesRequete.set("x-nonce", nonce);
  enTetesRequete.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: enTetesRequete } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Tout sauf les fichiers statiques déjà servis par Next et le favicon.
  // Aucune condition `missing` : elles portaient sur `next-router-prefetch` et
  // `purpose: prefetch`, deux en-têtes de requête ordinaires qu'un client pose lui-même.
  // `curl -H "purpose: prefetch" /` renvoyait alors le document entier sans CSP.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

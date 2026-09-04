import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ACCESS_COOKIE, DEVICE_COOKIE } from "@/lib/auth-cookie-names";

/* CSP à nonce (CLAUDE.md §4.6).
   Next injecte des scripts inline pour le streaming RSC : sans nonce, une CSP stricte
   casse la page. On génère donc un nonce par requête plutôt que d'ouvrir 'unsafe-inline'.
   Lecteur HLS maison (jeton CDN lié à l'IP) : pas d'iframe Bunny, `frame-src 'none`. */

const estDev = process.env.NODE_ENV === "development";

function origineBunny(): string {
  /* Hostname seulement, jamais une URL de fichier. Un caractère hors [a-z0-9.-]
     est refusé : la CSP n'est pas un endroit où interpoler de l'entrée brute. */
  const brut = (process.env.BUNNY_CDN_HOSTNAME ?? "").trim();
  const hote = brut.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!hote || !/^[a-z0-9.-]+$/i.test(hote)) return "";
  return `https://${hote}`;
}

function politiqueCsp(nonce: string): string {
  const bunny = origineBunny();
  return [
    "default-src 'self'",
    // 'strict-dynamic' : seuls les scripts porteurs du nonce, et ceux qu'ils chargent.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${estDev ? " 'unsafe-eval'" : ""}`,
    // Next et Tailwind injectent des styles inline ; aucune exécution de code n'en découle.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${estDev ? " ws: wss:" : ""}${bunny ? ` ${bunny}` : ""}`,
    bunny ? `media-src 'self' blob: ${bunny}` : "media-src 'self' blob:",
    "frame-ancestors 'none'",
    // Lecteur HLS maison, pas l'iframe Bunny : l'IP locking exige un jeton CDN.
    "frame-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // Inutile en local, et nuisible : forcerait le navigateur à réécrire en https
    // les requêtes vers un poste de développement servi en clair.
    ...(estDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/* Protection de /app et /admin (étape 1). Un simple contrôle de présence du cookie :
   la vraie autorisation reste côté Django (deny by default, §4.3) — ceci n'évite qu'un
   aller-retour inutile à un visiteur non connecté. Un cookie expiré mais présent laisse
   passer ici ; l'appel API qui suit échoue alors en 401 et déclenche un refresh côté client. */
const CHEMINS_PROTEGES = ["/app", "/admin"];

function cheminProtege(pathname: string): boolean {
  return CHEMINS_PROTEGES.some((prefixe) => pathname === prefixe || pathname.startsWith(`${prefixe}/`));
}

export function middleware(request: NextRequest): NextResponse {
  if (cheminProtege(request.nextUrl.pathname) && !request.cookies.get(ACCESS_COOKIE)) {
    const connexion = new URL("/connexion", request.url);
    connexion.searchParams.set("suite", request.nextUrl.pathname);
    return NextResponse.redirect(connexion);
  }

  const nonce = crypto.randomUUID();
  const csp = politiqueCsp(nonce);

  const enTetesRequete = new Headers(request.headers);
  enTetesRequete.set("x-nonce", nonce);
  enTetesRequete.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: enTetesRequete } });
  response.headers.set("Content-Security-Policy", csp);

  if (!request.cookies.get(DEVICE_COOKIE)) {
    response.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: !estDev,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

export const config = {
  // Tout sauf les fichiers statiques déjà servis par Next et le favicon.
  // Aucune condition `missing` : elles portaient sur `next-router-prefetch` et
  // `purpose: prefetch`, deux en-têtes de requête ordinaires qu'un client pose lui-même.
  // `curl -H "purpose: prefetch" /` renvoyait alors le document entier sans CSP.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/admin/proofs/).*)"],
};

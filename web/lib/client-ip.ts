import type { NextRequest } from "next/server";

/* Django n'est jamais exposé publiquement : sans ceci, Django ne verrait que l'IP du
   conteneur Next, ce qui viderait de son sens la limitation de débit par IP (§4.2). */
export function ipDuVisiteur(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "";
  return request.headers.get("x-real-ip") ?? "";
}

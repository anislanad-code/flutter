import "server-only";

import { cookies } from "next/headers";

import { ACCESS_COOKIE } from "@/lib/auth-cookie-names";

/* Le cookie httpOnly du navigateur n'atteint jamais Django tout seul (§3) : c'est le
   serveur Next qui le lit et le rattache à l'appel sortant.

   Les deux noms diffèrent volontairement. Côté navigateur le cookie s'appelle
   « session » (ACCESS_COOKIE) ; côté Django il s'appelle « access_token », le nom que
   lit `CookieAccessTokenAuthentication`. Un seul endroit fait la traduction, pour qu'on
   n'ait pas à s'en souvenir dans chaque Route Handler. */

const COOKIE_DJANGO = "access_token";

function enTetes(valeur: string | undefined): Record<string, string> | null {
  if (!valeur) return null;
  return { Cookie: `${COOKIE_DJANGO}=${valeur}` };
}

/** À utiliser dans les Server Components. */
export async function enTetesSession(): Promise<Record<string, string> | null> {
  return enTetes((await cookies()).get(ACCESS_COOKIE)?.value);
}

/** À utiliser dans les Route Handlers, qui disposent déjà de la requête. */
export function enTetesSessionDepuis(requete: {
  cookies: { get(nom: string): { value: string } | undefined };
}): Record<string, string> | null {
  return enTetes(requete.cookies.get(ACCESS_COOKIE)?.value);
}

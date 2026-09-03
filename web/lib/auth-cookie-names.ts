/* Noms des cookies httpOnly du BFF. Fichier séparé, sans le garde `server-only` :
   le middleware (runtime edge) et les Route Handlers en ont besoin tous les deux. */
export const ACCESS_COOKIE = "session";
export const REFRESH_COOKIE = "refresh";

/* Noms des cookies httpOnly du BFF. Fichier séparé, sans le garde `server-only` :
   le middleware (runtime edge) et les Route Handlers en ont besoin tous les deux. */
export const ACCESS_COOKIE = "session";
export const REFRESH_COOKIE = "refresh";
/* Empreinte d'appareil pour la détection de partage (§4.1.6). Pas de l'auth :
   un UUID posé par le middleware, httpOnly, distinct des cookies de session. */
export const DEVICE_COOKIE = "device";

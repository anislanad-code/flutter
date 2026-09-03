import type { NextConfig } from "next";

/* En-têtes de sécurité statiques (CLAUDE.md §4.6).
   La CSP n'est pas ici : elle dépend d'un nonce par requête, donc elle est posée
   par middleware.ts. */
const enProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS n'a rien à faire sur http://localhost : un navigateur qui l'a mémorisé
  // refusera ensuite toute connexion en clair vers cet hôte, y compris sur un autre port.
  ...(enProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

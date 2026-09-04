import { z } from "zod";

/* Seule variable publique du front (§3, .env.example) : l'URL du site lui-même,
   utilisée pour construire des URLs absolues (sitemap, Open Graph). Ne jamais y
   ajouter API_INTERNAL_URL ou tout ce qui concerne Django (lib/env.ts, server-only). */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url({ protocol: /^https?$/ }),
});

let cache: z.infer<typeof publicEnvSchema> | null = null;

// Contrairement à `lib/env.ts` (API_INTERNAL_URL, sans défaut : une valeur absente doit
// faire échouer le démarrage), cette variable ne sert qu'à construire des URLs
// absolues cosmétiques (sitemap, Open Graph, metadataBase) — un défaut de développement
// est sûr, et évite d'avoir à la poser dans chaque environnement de test ou de CI.
const DEFAUT_DEV = "http://localhost:3000";

export function serverEnv(): z.infer<typeof publicEnvSchema> {
  if (cache) return cache;

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || DEFAUT_DEV,
  });

  if (!parsed.success) {
    throw new Error(
      `Configuration publique incomplète : ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  cache = parsed.data;
  return cache;
}

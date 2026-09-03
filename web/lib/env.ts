import { z } from "zod";

/* Variables d'environnement lues côté serveur uniquement.
   Rien ici n'est préfixé NEXT_PUBLIC_ : le navigateur ne connaît pas Django. */
const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url(),
});

let cache: z.infer<typeof serverEnvSchema> | null = null;

export function serverEnv(): z.infer<typeof serverEnvSchema> {
  if (cache) return cache;

  const parsed = serverEnvSchema.safeParse({
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  });

  if (!parsed.success) {
    // Le message ne contient que les noms de variables, jamais leurs valeurs.
    throw new Error(
      `Configuration serveur incomplète : ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  cache = parsed.data;
  return cache;
}

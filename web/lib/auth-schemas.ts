import { z } from "zod";

/* Le front ne fait jamais confiance à la forme des données renvoyées par Django (§7). */

export const utilisateurSchema = z.object({
  id: z.number(),
  email: z.string(),
  phone: z.string(),
  is_staff: z.boolean(),
  flagged_for_review: z.boolean(),
  created_at: z.string(),
  last_activity_at: z.string().nullable(),
});

export const sessionEmiseSchema = z.object({
  access_token: z.string(),
  access_token_expires_in: z.number(),
  refresh_token: z.string(),
  refresh_token_expires_in: z.number(),
  user: utilisateurSchema,
});

export type Utilisateur = z.infer<typeof utilisateurSchema>;
export type SessionEmise = z.infer<typeof sessionEmiseSchema>;

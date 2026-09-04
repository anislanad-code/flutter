import { z } from "zod";

/* Réponse de `POST /api/lessons/{id}/playback`. `playback_url` est une URL signée
   à TTL court, liée à l'IP : ce n'est pas une URL de fichier rejouable (§4.1.1). */

export const lectureSchema = z.object({
  disponible: z.boolean(),
  playback_id: z.string().nullable(),
  playback_url: z
    .string()
    .nullable()
    .refine((valeur) => valeur === null || valeur.startsWith("https://")),
  expires_at: z.string().nullable(),
  watermark_label: z.string(),
  resume_at_s: z.number().int().nonnegative(),
  duration_s: z.number().int().nonnegative(),
});

export const battementSchema = z.object({
  active: z.boolean(),
  expires_at: z.string(),
  resume_at_s: z.number().int().nonnegative(),
});

export type Lecture = z.infer<typeof lectureSchema>;
export type Battement = z.infer<typeof battementSchema>;

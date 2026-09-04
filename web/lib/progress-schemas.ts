import { z } from "zod";

/* Le front ne fait jamais confiance à la forme des données renvoyées par Django (§7). */

export const etatNoeudSchema = z.enum([
  "termine",
  "en_cours",
  "disponible",
  "recommande_plus_tard",
]);

export const chapitreEtatSchema = z.object({
  id: z.number(),
  slug: z.string(),
  order: z.number(),
  title: z.string(),
  is_free: z.boolean(),
  state: etatNoeudSchema,
});

export const moduleEtatSchema = z.object({
  id: z.number(),
  order: z.number(),
  title: z.string(),
  unlocked: z.boolean(),
  completed_chapters: z.number(),
  total_chapters: z.number(),
  chapters: z.array(chapitreEtatSchema),
});

export const pipelineSchema = z.object({
  course_slug: z.string(),
  resume_chapter_slug: z.string().nullable(),
  modules: z.array(moduleEtatSchema),
});

export const chapitreCompleteSchema = z.object({
  chapter_slug: z.string(),
  state: z.literal("termine"),
});

export type EtatNoeud = z.infer<typeof etatNoeudSchema>;
export type ChapitreEtat = z.infer<typeof chapitreEtatSchema>;
export type ModuleEtat = z.infer<typeof moduleEtatSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;

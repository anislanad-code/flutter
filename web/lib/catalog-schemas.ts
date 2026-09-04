import { z } from "zod";

/* Le front ne fait jamais confiance à la forme des données renvoyées par Django (§7). */

export const chapitreResumeSchema = z.object({
  id: z.number(),
  slug: z.string(),
  order: z.number(),
  title: z.string(),
  is_free: z.boolean(),
});

export const moduleResumeSchema = z.object({
  id: z.number(),
  order: z.number(),
  title: z.string(),
  summary: z.string(),
  chapters: z.array(chapitreResumeSchema),
});

export const coursPublicSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  modules: z.array(moduleResumeSchema),
});

export const ressourceSchema = z.object({
  titre: z.string(),
  url: z.string(),
});

export const leconSchema = z.object({
  video_provider_id: z.string(),
  duration_s: z.number(),
  transcript: z.string(),
  resources: z.array(ressourceSchema),
});

export const chapitreSchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  is_free: z.boolean(),
  lesson: leconSchema,
  module_title: z.string(),
  course_slug: z.string(),
  course_title: z.string(),
});

/* La route publique ne sert **que** des chapitres gratuits : `is_free` y est un
   littéral, pas un booléen. Si Django renvoyait un jour un chapitre payant par cette
   route, le parsing échouerait ici plutôt que de l'afficher (§7). */
export const chapitreGratuitSchema = chapitreSchema.extend({
  is_free: z.literal(true),
});

export type ChapitreResume = z.infer<typeof chapitreResumeSchema>;
export type ModuleResume = z.infer<typeof moduleResumeSchema>;
export type CoursPublic = z.infer<typeof coursPublicSchema>;
export type Chapitre = z.infer<typeof chapitreSchema>;
export type ChapitreGratuit = z.infer<typeof chapitreGratuitSchema>;

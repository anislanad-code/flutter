import { z } from "zod";

/* Le front ne fait jamais confiance à la forme des données renvoyées par Django (§7).
   `choixPublicSchema` ne porte que `id` et `text` — un `is_correct` qui apparaîtrait ici
   ferait échouer le parsing plutôt que de l'afficher (même logique que
   `chapitreGratuitSchema` pour le paywall). */

export const choixPublicSchema = z.object({
  id: z.number(),
  text: z.string(),
});

export const questionPubliqueSchema = z.object({
  id: z.number(),
  order: z.number(),
  text: z.string(),
  choices: z.array(choixPublicSchema),
});

export const etatQuizSchema = z.object({
  id: z.number(),
  kind: z.enum(["chapitre", "examen"]),
  pass_threshold: z.number(),
  max_attempts: z.number(),
  min_duration_s: z.number(),
  attempts_used: z.number(),
  attempts_remaining: z.number(),
  best_score: z.number().nullable(),
  questions: z.array(questionPubliqueSchema),
});

export const tentativeDemarreeSchema = z.object({
  id: z.number(),
  started_at: z.string(),
});

export const choixCorrigeSchema = z.object({
  id: z.number(),
  text: z.string(),
  is_correct: z.boolean(),
  chosen: z.boolean(),
});

export const questionCorrigeeSchema = z.object({
  id: z.number(),
  text: z.string(),
  explanation: z.string(),
  choices: z.array(choixCorrigeSchema),
});

export const resultatTentativeSchema = z.object({
  attempt_id: z.number(),
  score: z.number(),
  passed: z.boolean(),
  pass_threshold: z.number(),
  attempts_remaining: z.number(),
  questions: z.array(questionCorrigeeSchema),
});

export type ChoixPublic = z.infer<typeof choixPublicSchema>;
export type QuestionPublique = z.infer<typeof questionPubliqueSchema>;
export type EtatQuiz = z.infer<typeof etatQuizSchema>;
export type TentativeDemarree = z.infer<typeof tentativeDemarreeSchema>;
export type ResultatTentative = z.infer<typeof resultatTentativeSchema>;

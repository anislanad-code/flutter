import { z } from "zod";

/* Le front ne fait jamais confiance à la forme des données renvoyées par Django (§7).
   Ces schémas décrivent exactement ce que l'API a le droit de renvoyer : un champ
   inattendu côté Django ne devient jamais une propriété utilisée ici par accident. */

export const statutInscriptionSchema = z.enum(["PENDING", "ACTIVE", "BLOCKED", "EXPIRED"]);

export const statutPreuveSchema = z.enum(["SUBMITTED", "ACCEPTED", "REJECTED"]);

export const instructionsPaiementSchema = z.object({
  provider: z.string(),
  requiert_preuve: z.boolean(),
  amount_dzd: z.number(),
  account_label: z.string(),
  account_number: z.string(),
  account_key: z.string(),
  account_holder: z.string(),
  reference: z.string(),
});

export const preuveEtudiantSchema = z.object({
  id: z.string(),
  status: statutPreuveSchema,
  amount_declared: z.number(),
  reject_reason: z.string(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
});

export const etatInscriptionSchema = z.object({
  status: statutInscriptionSchema,
  course_slug: z.string().nullable(),
  depot_possible: z.boolean(),
  instructions: instructionsPaiementSchema,
  derniere_preuve: preuveEtudiantSchema.nullable(),
});

export const preuveAdminSchema = z.object({
  id: z.string(),
  status: statutPreuveSchema,
  amount_declared: z.number(),
  content_type: z.string(),
  byte_size: z.number(),
  reject_reason: z.string(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
  purged_at: z.string().nullable(),
});

export const inscriptionAdminSchema = z.object({
  id: z.number(),
  status: statutInscriptionSchema,
  user_email: z.string(),
  user_phone: z.string(),
  course_title: z.string().nullable(),
  reference: z.string(),
  note_admin: z.string(),
  created_at: z.string(),
  activated_at: z.string().nullable(),
  preuves: z.array(preuveAdminSchema),
});

export const listeInscriptionsSchema = z.array(inscriptionAdminSchema);

export type StatutInscription = z.infer<typeof statutInscriptionSchema>;
export type StatutPreuve = z.infer<typeof statutPreuveSchema>;
export type InstructionsPaiement = z.infer<typeof instructionsPaiementSchema>;
export type PreuveEtudiant = z.infer<typeof preuveEtudiantSchema>;
export type EtatInscription = z.infer<typeof etatInscriptionSchema>;
export type PreuveAdmin = z.infer<typeof preuveAdminSchema>;
export type InscriptionAdmin = z.infer<typeof inscriptionAdminSchema>;

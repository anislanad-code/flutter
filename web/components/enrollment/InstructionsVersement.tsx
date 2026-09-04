import type { InstructionsPaiement } from "@/lib/enrollment-schemas";

type Props = {
  instructions: InstructionsPaiement;
};

/* Les coordonnées de versement. Pas de police mono : un numéro de compte n'est pas du
   code (§6). Les chiffres passent en chasse tabulaire pour se recopier sans erreur. */
export function InstructionsVersement({ instructions }: Props) {
  const lignes: { terme: string; valeur: string; chiffres?: boolean }[] = [
    { terme: "Montant", valeur: `${instructions.amount_dzd.toLocaleString("fr-DZ")} DA`, chiffres: true },
    { terme: instructions.account_label, valeur: instructions.account_number, chiffres: true },
    { terme: "Clé", valeur: instructions.account_key, chiffres: true },
    { terme: "Au nom de", valeur: instructions.account_holder },
    { terme: "À écrire sur le bordereau", valeur: instructions.reference, chiffres: true },
  ];

  return (
    <section aria-labelledby="titre-versement" className="flex flex-col gap-4">
      <h2 id="titre-versement" className="font-titre text-[length:var(--texte-xl)] font-semibold text-ink">
        Verse au {instructions.account_label}
      </h2>
      <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
        Va au bureau de poste ou passe par BaridiMob, puis reviens ici envoyer une photo
        du reçu. Écris bien la référence sur le bordereau : c&apos;est ce qui permet de
        retrouver ton versement.
      </p>

      <dl className="divide-y divide-muted/30 border-y border-muted/30">
        {lignes.map((ligne) => (
          <div key={ligne.terme} className="flex flex-wrap items-baseline justify-between gap-x-6 py-3">
            <dt className="text-[length:var(--texte-sm)] text-ink">{ligne.terme}</dt>
            <dd
              className={`text-[length:var(--texte-base)] font-medium text-ink ${
                ligne.chiffres ? "tabular-nums" : ""
              }`}
            >
              {ligne.valeur}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

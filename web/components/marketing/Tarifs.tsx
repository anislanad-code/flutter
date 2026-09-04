import { FormulaireListeAttente } from "@/components/marketing/FormulaireListeAttente";

/* Paiement manuel CCP + preuve (§2). Le prix est une valeur, jamais "CCP" codé en dur
   dans la logique — ici c'est juste du texte, l'interface PaymentProvider arrive à
   l'étape 3. */
const PRIX_DA = 15_000;

export function Tarifs() {
  return (
    <section aria-labelledby="titre-tarifs" className="border-t border-muted/40 py-16">
      <h2 id="titre-tarifs" className="font-titre text-[length:var(--texte-2xl)] font-semibold">
        Un seul prix, un seul palier
      </h2>
      <p className="mt-3 max-w-mesure text-[length:var(--texte-base)] text-muted">
        Pas d&apos;abonnement, pas de palier premium. Tu payes une fois, tu gardes l&apos;accès.
      </p>

      <div className="mt-8 max-w-sm rounded-lg border border-ink p-6">
        <p className="font-titre text-[length:var(--texte-4xl)] font-semibold">
          {PRIX_DA.toLocaleString("fr-DZ")} DA
        </p>
        <p className="mt-1 text-[length:var(--texte-sm)] text-muted">
          Paiement unique. Accès à vie à la formation.
        </p>
        <ul className="mt-6 flex flex-col gap-2 text-[length:var(--texte-sm)]">
          <li>— Tous les modules, du premier au dernier</li>
          <li>— QCM de fin de chapitre et examens de module</li>
          <li>— Mises à jour du contenu incluses</li>
        </ul>
        <p className="mt-6 text-[length:var(--texte-sm)] text-muted">
          Versement CCP, puis reçu à téléverser depuis ton compte — validé sous 24 h.
        </p>
      </div>

      <div className="mt-10 max-w-2xl">
        <h3 className="font-titre text-[length:var(--texte-lg)] font-semibold">
          Pas encore prêt·e à payer ?
        </h3>
        <p className="mt-2 max-w-mesure text-[length:var(--texte-sm)] text-muted">
          Laisse ton email, on te préviendra à chaque nouveau chapitre publié.
        </p>
        <div className="mt-4">
          <FormulaireListeAttente />
        </div>
      </div>
    </section>
  );
}

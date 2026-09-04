import type { Metadata } from "next";

import { FormulaireInscription } from "@/components/auth/FormulaireInscription";

export const metadata: Metadata = { title: "Créer un compte — anis.dev" };

export default function PageInscription() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Crée ton compte
        </h1>
        <p className="text-[length:var(--texte-base)] text-ink">
          Le premier chapitre est accessible tout de suite, sans paiement.
        </p>
      </header>
      <FormulaireInscription />
      <p className="text-center text-[length:var(--texte-sm)] text-ink">
        Déjà un compte ?{" "}
        <a href="/connexion" className="text-zellige underline underline-offset-4">
          Connecte-toi
        </a>
      </p>
    </div>
  );
}

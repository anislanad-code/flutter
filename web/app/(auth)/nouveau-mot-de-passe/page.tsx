import type { Metadata } from "next";
import { Suspense } from "react";

import { FormulaireNouveauMotDePasse } from "@/components/auth/FormulaireNouveauMotDePasse";

export const metadata: Metadata = { title: "Nouveau mot de passe — anis.dev" };

export default function PageNouveauMotDePasse() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Choisis un nouveau mot de passe
        </h1>
      </header>
      <Suspense>
        <FormulaireNouveauMotDePasse />
      </Suspense>
    </div>
  );
}

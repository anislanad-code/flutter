import type { Metadata } from "next";

import { FormulaireMotDePasseOublie } from "@/components/auth/FormulaireMotDePasseOublie";

export const metadata: Metadata = { title: "Mot de passe oublié — anis.dev" };

export default function PageMotDePasseOublie() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Mot de passe oublié
        </h1>
        <p className="text-[length:var(--texte-base)] text-muted">
          Indique ton email : on t&apos;envoie un lien pour en choisir un nouveau.
        </p>
      </header>
      <FormulaireMotDePasseOublie />
    </div>
  );
}

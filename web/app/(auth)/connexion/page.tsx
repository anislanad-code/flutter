import type { Metadata } from "next";
import { Suspense } from "react";

import { FormulaireConnexion } from "@/components/auth/FormulaireConnexion";

export const metadata: Metadata = { title: "Se connecter — anis.dev" };

export default function PageConnexion() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Connecte-toi
        </h1>
      </header>
      <Suspense>
        <FormulaireConnexion />
      </Suspense>
      <p className="text-center text-[length:var(--texte-sm)] text-muted">
        Pas encore de compte ?{" "}
        <a href="/inscription" className="text-zellige underline underline-offset-4">
          Crée-en un
        </a>
      </p>
    </div>
  );
}

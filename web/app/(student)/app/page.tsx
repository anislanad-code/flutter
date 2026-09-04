import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BoutonDeconnexion } from "@/components/auth/BoutonDeconnexion";
import { utilisateurCourant } from "@/lib/current-user";

export const metadata: Metadata = { title: "Ton espace — anis.dev" };
export const dynamic = "force-dynamic";

/* Le parcours (pipeline), le chapitre gratuit et le reste du contenu arrivent aux
   étapes 2 et suivantes. Pour l'étape 1, cette page prouve seulement que la session
   fonctionne : le middleware protège /app, et l'utilisateur voit qui il est. */
export default async function PageEspaceEtudiant() {
  const utilisateur = await utilisateurCourant();
  if (!utilisateur) redirect("/connexion?suite=/app");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Bienvenue, {utilisateur.email}
        </h1>
        <p className="text-[length:var(--texte-base)] text-ink">
          Le parcours et le chapitre gratuit arrivent à l&apos;étape 2.
        </p>
      </header>
      <BoutonDeconnexion />
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BoutonDeconnexion } from "@/components/auth/BoutonDeconnexion";
import { utilisateurCourant } from "@/lib/current-user";

export const metadata: Metadata = { title: "Administration — anis.dev", robots: { index: false } };
export const dynamic = "force-dynamic";

/* Back-office complet à l'étape 7. Ici : le point d'entrée vers la file des
   inscriptions, et la preuve que /admin est réservé à un compte is_staff (le statut
   vient de Django, jamais du client — §4.3). */
export default async function PageAdmin() {
  const utilisateur = await utilisateurCourant();
  if (!utilisateur) redirect("/connexion?suite=/admin");
  if (!utilisateur.is_staff) redirect("/app");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Administration
        </h1>
        <p className="text-[length:var(--texte-base)] text-ink">
          Le tableau de bord complet arrive à l&apos;étape 7.
        </p>
      </header>

      <nav aria-label="Sections" className="flex flex-col gap-2">
        <Link
          href="/admin/inscriptions"
          className="self-start text-[length:var(--texte-base)] text-zellige underline underline-offset-4"
        >
          Inscriptions à valider
        </Link>
      </nav>

      <BoutonDeconnexion />
    </main>
  );
}

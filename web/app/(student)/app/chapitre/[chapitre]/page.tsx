import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LecteurChapitre } from "@/components/course/LecteurChapitre";
import { recupererChapitreAuthentifie } from "@/lib/catalog";
import { utilisateurCourant } from "@/lib/current-user";

export const metadata: Metadata = {
  // Aucun titre tiré du chapitre : ce serait un oracle d'existence pour un contenu
  // payant. Et rien de tout cela n'a à être indexé.
  title: "Chapitre — anis.dev",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ chapitre: string }>;
};

/* Lecture d'un chapitre par un compte connecté.

   Provisoire, et assumé comme tel : la progression, la navigation chapitre à chapitre
   et le suivi de lecture arrivent à l'étape 5. Ce que cette page prouve dès
   maintenant, c'est que le paywall tient de bout en bout — un compte `PENDING` qui
   tape l'URL d'un chapitre payant tombe sur la même 404 qu'un chapitre inexistant,
   parce que Django ne renvoie rien et que rien n'est reconstruit ici. */
export default async function PageChapitreEtudiant({ params }: Props) {
  const utilisateur = await utilisateurCourant();
  const { chapitre: slug } = await params;
  if (!utilisateur) redirect(`/connexion?suite=/app/chapitre/${slug}`);

  const chapitre = await recupererChapitreAuthentifie(slug);
  if (!chapitre) notFound();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-5 py-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/app"
          className="self-start text-[length:var(--texte-sm)] text-zellige underline underline-offset-4"
        >
          Retour au parcours
        </Link>
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          {chapitre.title}
        </h1>
        <p className="text-[length:var(--texte-sm)] text-ink">{chapitre.module_title}</p>
      </header>

      <LecteurChapitre chapitre={chapitre} />
    </main>
  );
}

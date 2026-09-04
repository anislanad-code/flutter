import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LecteurChapitre } from "@/components/course/LecteurChapitre";
import {
  recupererChapitreAuthentifie,
  SLUG_FORMATION_PRINCIPALE,
} from "@/lib/catalog";
import { utilisateurCourant } from "@/lib/current-user";
import { moduleDuChapitre, recupererPipeline } from "@/lib/progress";

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

/* Lecture d'un chapitre par un compte connecté, avec suivi de progression (§5) : le
   bouton « Marquer ce chapitre comme terminé » écrit l'état côté serveur, et ramène
   au pipeline pour montrer le nœud passer à `terminé`. Le paywall tient toujours de
   bout en bout — un compte `PENDING` qui tape l'URL d'un chapitre payant tombe sur la
   même 404 qu'un chapitre inexistant, parce que Django ne renvoie rien et que rien
   n'est reconstruit ici. */
export default async function PageChapitreEtudiant({ params }: Props) {
  const utilisateur = await utilisateurCourant();
  const { chapitre: slug } = await params;
  if (!utilisateur) redirect(`/connexion?suite=/app/chapitre/${slug}`);

  const [chapitre, resultatPipeline] = await Promise.all([
    recupererChapitreAuthentifie(slug),
    recupererPipeline(SLUG_FORMATION_PRINCIPALE),
  ]);
  if (!chapitre) notFound();

  // Best-effort : si le pipeline n'a pas pu être chargé, la page reste utilisable —
  // seul le bandeau de recommandation et l'état déjà-terminé du bouton en dépendent,
  // jamais le droit de lire le chapitre (ça, c'est déjà tranché par Django ci-dessus).
  const moduleDeCeChapitre = resultatPipeline.ok
    ? moduleDuChapitre(resultatPipeline.pipeline, slug)
    : null;
  const recommandeApresOrdre =
    moduleDeCeChapitre && !moduleDeCeChapitre.unlocked
      ? moduleDeCeChapitre.recommande_apres_ordre
      : null;
  const dejaTermine =
    moduleDeCeChapitre?.chapters.find((c) => c.slug === slug)?.state ===
    "termine";

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
        <p className="text-[length:var(--texte-sm)] text-ink">
          {chapitre.module_title}
        </p>
      </header>

      {recommandeApresOrdre !== null ? (
        <section
          aria-labelledby="titre-recommandation"
          className="flex flex-col gap-1 border-l-2 border-safran bg-paper py-1 pl-5"
        >
          <h2
            id="titre-recommandation"
            className="font-titre text-[length:var(--texte-base)] font-semibold text-ink"
          >
            Ce chapitre arrive avant l&apos;heure
          </h2>
          <p className="text-[length:var(--texte-sm)] text-ink">
            Termine d&apos;abord le module {recommandeApresOrdre} — tu peux
            quand même continuer ici si tu préfères.
          </p>
        </section>
      ) : null}

      <LecteurChapitre
        chapitre={chapitre}
        avecSuiviDeProgression
        dejaTermine={dejaTermine}
      />
    </main>
  );
}

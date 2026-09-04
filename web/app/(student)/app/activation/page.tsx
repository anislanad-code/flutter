import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormulaireRecu } from "@/components/enrollment/FormulaireRecu";
import { InstructionsVersement } from "@/components/enrollment/InstructionsVersement";
import { utilisateurCourant } from "@/lib/current-user";
import { recupererEtatInscription } from "@/lib/enrollment";

export const metadata: Metadata = {
  title: "Ouvrir ton accès — anis.dev",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

export default async function PageActivation() {
  const utilisateur = await utilisateurCourant();
  if (!utilisateur) redirect("/connexion?suite=/app/activation");

  const etat = await recupererEtatInscription();
  if (!etat) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-5 py-16">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Ouvrir ton accès
        </h1>
        <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
          Les informations de versement n&apos;ont pas pu être chargées. Recharge la page
          dans un instant.
        </p>
      </main>
    );
  }

  // Un compte déjà actif n'a rien à faire ici : on le renvoie à son parcours plutôt que
  // de lui proposer un formulaire qui serait refusé.
  if (etat.status === "ACTIVE") redirect("/app");

  const refuse = etat.derniere_preuve?.status === "REJECTED";
  const enExamen = etat.derniere_preuve?.status === "SUBMITTED";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-10 px-5 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          Ouvrir ton accès
        </h1>
        <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
          Deux étapes : tu verses, tu envoies le reçu. La validation est faite à la main,
          sous 24 h.
        </p>
      </header>

      {etat.depot_possible ? (
        <>
          {refuse && etat.derniere_preuve ? (
            <section
              aria-labelledby="titre-refus"
              className="flex flex-col gap-2 border-l-2 border-danger py-1 pl-5"
            >
              <h2 id="titre-refus" className="font-titre text-[length:var(--texte-lg)] font-semibold text-ink">
                Le reçu précédent n&apos;a pas pu être validé
              </h2>
              <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
                {etat.derniere_preuve.reject_reason}
              </p>
            </section>
          ) : null}

          <InstructionsVersement instructions={etat.instructions} />

          <section aria-labelledby="titre-recu" className="flex flex-col gap-4">
            <h2 id="titre-recu" className="font-titre text-[length:var(--texte-xl)] font-semibold text-ink">
              Envoie ton reçu
            </h2>
            <FormulaireRecu montantAttendu={etat.instructions.amount_dzd} />
          </section>
        </>
      ) : enExamen ? (
        <section
          aria-labelledby="titre-attente"
          className="flex flex-col gap-3 border-l-2 border-safran py-1 pl-5"
        >
          <h2 id="titre-attente" className="font-titre text-[length:var(--texte-xl)] font-semibold text-ink">
            Reçu envoyé
          </h2>
          <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
            On a ta capture. Réponse sous 24 h, par email. Il n&apos;y a rien d&apos;autre
            à faire pour l&apos;instant.
          </p>
          <Link
            href="/app"
            className="self-start text-[length:var(--texte-base)] text-zellige underline underline-offset-4"
          >
            Retourner au parcours
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
            Ton accès n&apos;attend plus de reçu. Retourne au parcours.
          </p>
          <Link
            href="/app"
            className="self-start text-[length:var(--texte-base)] text-zellige underline underline-offset-4"
          >
            Retourner au parcours
          </Link>
        </section>
      )}
    </main>
  );
}

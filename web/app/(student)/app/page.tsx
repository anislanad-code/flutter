import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BoutonDeconnexion } from "@/components/auth/BoutonDeconnexion";
import { ParcoursEtudiant } from "@/components/student/ParcoursEtudiant";
import { recupererCours, SLUG_FORMATION_PRINCIPALE } from "@/lib/catalog";
import { utilisateurCourant } from "@/lib/current-user";
import { recupererEtatInscription } from "@/lib/enrollment";

export const metadata: Metadata = { title: "Ton espace — anis.dev", robots: { index: false } };
export const dynamic = "force-dynamic";

/* Tableau de bord. Un compte en attente voit le parcours complet, pas une page vide :
   le chapitre gratuit est ouvert, le reste est visible mais grisé, et une bannière dit
   exactement où il en est et quoi faire ensuite (§6 — dire quoi corriger). */
export default async function PageEspaceEtudiant() {
  const utilisateur = await utilisateurCourant();
  if (!utilisateur) redirect("/connexion?suite=/app");

  const [etat, cours] = await Promise.all([
    recupererEtatInscription(),
    recupererCours(SLUG_FORMATION_PRINCIPALE),
  ]);

  const statut = etat?.status ?? "PENDING";
  const preuve = etat?.derniere_preuve ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-10 px-5 py-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
            Ton parcours
          </h1>
          <p className="text-[length:var(--texte-sm)] text-ink">{utilisateur.email}</p>
        </div>
        <BoutonDeconnexion />
      </header>

      {statut !== "ACTIVE" ? (
        <section
          aria-labelledby="titre-acces"
          className="flex flex-col gap-3 border-l-2 border-safran bg-paper py-1 pl-5"
        >
          <h2 id="titre-acces" className="font-titre text-[length:var(--texte-xl)] font-semibold text-ink">
            {preuve?.status === "SUBMITTED"
              ? "Ton reçu est en cours de vérification"
              : "Ouvre la formation complète"}
          </h2>

          {preuve?.status === "SUBMITTED" ? (
            <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
              On a bien reçu ta capture. Réponse sous 24 h, par email. Pendant ce temps, le
              premier chapitre reste ouvert.
            </p>
          ) : preuve?.status === "REJECTED" ? (
            <>
              <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
                Ton reçu n&apos;a pas pu être validé. Motif : {preuve.reject_reason}
              </p>
              <Link
                href="/app/activation"
                className="self-start rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90"
              >
                Renvoyer un reçu
              </Link>
            </>
          ) : (
            <>
              <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
                Le premier chapitre est ouvert dès maintenant. Pour la suite, verse au{" "}
                {etat?.instructions.account_label ?? "compte indiqué"} puis envoie une photo du
                reçu.
              </p>
              <Link
                href="/app/activation"
                className="self-start rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90"
              >
                Envoyer le reçu
              </Link>
            </>
          )}
        </section>
      ) : null}

      {cours ? (
        <ParcoursEtudiant cours={cours} statut={statut} />
      ) : (
        <p className="text-[length:var(--texte-base)] text-ink">
          Le programme n&apos;a pas pu être chargé. Recharge la page dans un instant.
        </p>
      )}
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FileInscriptions } from "@/components/admin/FileInscriptions";
import { utilisateurCourant } from "@/lib/current-user";
import { recupererInscriptionsAdmin } from "@/lib/enrollment";
import { statutInscriptionSchema, type StatutInscription } from "@/lib/enrollment-schemas";

export const metadata: Metadata = {
  title: "Inscriptions — anis.dev",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const FILTRES: { valeur: StatutInscription | "TOUS"; libelle: string }[] = [
  { valeur: "PENDING", libelle: "En attente" },
  { valeur: "ACTIVE", libelle: "Actives" },
  { valeur: "TOUS", libelle: "Toutes" },
];

type Props = {
  searchParams: Promise<{ statut?: string }>;
};

export default async function PageInscriptions({ searchParams }: Props) {
  const utilisateur = await utilisateurCourant();
  if (!utilisateur) redirect("/connexion?suite=/admin/inscriptions");
  // Deuxième verrou seulement : Django renvoie déjà 404 à un non-admin sur toutes les
  // routes d'administration (§4.3). Celui-ci évite d'afficher une page vide.
  if (!utilisateur.is_staff) redirect("/app");

  /* Le paramètre d'URL est comparé à une allow-list, jamais relayé tel quel : c'est un
     filtre qui finit dans une requête côté Django. Une valeur inconnue retombe sur
     « en attente », la file qu'on ouvre neuf fois sur dix. */
  const { statut: brut } = await searchParams;
  const analyse = statutInscriptionSchema.safeParse(brut);
  const filtreActif: StatutInscription | "TOUS" =
    brut === "TOUS" ? "TOUS" : analyse.success ? analyse.data : "PENDING";
  const inscriptions =
    (await recupererInscriptionsAdmin(filtreActif === "TOUS" ? undefined : filtreActif)) ?? [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-titre text-[length:var(--texte-2xl)] font-semibold text-ink">
          Inscriptions
        </h1>
        <p className="text-[length:var(--texte-sm)] text-ink">
          Chaque validation et chaque refus laisse une trace non modifiable, avec ton nom
          et l&apos;heure.
        </p>
      </header>

      <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-4">
        {FILTRES.map((filtre) => (
          <Link
            key={filtre.valeur}
            href={filtre.valeur === "TOUS" ? "/admin/inscriptions" : `?statut=${filtre.valeur}`}
            aria-current={filtre.valeur === filtreActif ? "page" : undefined}
            className={
              filtre.valeur === filtreActif
                ? "text-[length:var(--texte-sm)] font-medium text-ink underline underline-offset-4"
                : "text-[length:var(--texte-sm)] text-ink underline-offset-4 hover:underline"
            }
          >
            {filtre.libelle}
          </Link>
        ))}
      </nav>

      <FileInscriptions inscriptions={inscriptions} />
    </main>
  );
}

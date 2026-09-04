import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormulaireListeAttente } from "@/components/marketing/FormulaireListeAttente";
import { LecteurChapitre } from "@/components/course/LecteurChapitre";
import { recupererChapitreGratuit } from "@/lib/catalog";

type Props = {
  params: Promise<{ chapitre: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chapitre: slug } = await params;
  const chapitre = await recupererChapitreGratuit(slug);
  if (!chapitre) return { title: "Chapitre introuvable — anis.dev" };

  return {
    title: `${chapitre.title} — ${chapitre.course_title}`,
    description: `Chapitre gratuit de la formation ${chapitre.course_title} : ${chapitre.title}.`,
    alternates: { canonical: `/gratuit/${chapitre.slug}` },
    openGraph: {
      title: chapitre.title,
      description: `Chapitre gratuit de la formation ${chapitre.course_title}.`,
      type: "article",
      locale: "fr_FR",
    },
  };
}

export default async function ChapitreGratuitPage({ params }: Props) {
  const { chapitre: slug } = await params;
  const chapitre = await recupererChapitreGratuit(slug);

  // Un chapitre payant, ou qui n'existe pas, ou dont le cours n'est plus publié :
  // même 404, jamais de fuite de titre (§4.4). `recupererChapitreGratuit` applique
  // déjà cette règle côté Django ; on ne fait ici que relayer l'absence de résultat.
  if (!chapitre) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <p className="text-[length:var(--texte-sm)] text-ink">
        <Link href="/" className="underline underline-offset-4">
          {chapitre.course_title}
        </Link>{" "}
        · {chapitre.module_title}
      </p>
      <h1 className="mt-2 font-titre text-[length:var(--texte-4xl)] font-semibold tracking-tight">
        {chapitre.title}
      </h1>
      <p className="mt-2 text-[length:var(--texte-sm)] text-zellige">
        Chapitre gratuit — pas besoin de compte pour le suivre.
      </p>

      <div className="mt-10">
        <LecteurChapitre chapitre={chapitre} />
      </div>

      <div className="mt-16 rounded-lg border border-ink p-6">
        <h2 className="font-titre text-[length:var(--texte-lg)] font-semibold">
          La suite t&apos;intéresse ?
        </h2>
        <p className="mt-2 max-w-mesure text-[length:var(--texte-sm)] text-ink">
          Crée ton compte pour garder ta progression, ou laisse ton email pour être
          prévenu·e des prochains chapitres.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Link
            href="/inscription"
            className="rounded bg-zellige px-5 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Créer mon compte
          </Link>
        </div>
        <div className="mt-6">
          <FormulaireListeAttente />
        </div>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { EnTeteMarketing } from "@/components/marketing/EnTeteMarketing";
import { Faq } from "@/components/marketing/Faq";
import { LecteurChapitre } from "@/components/course/LecteurChapitre";
import { Parcours } from "@/components/marketing/Parcours";
import { Tarifs } from "@/components/marketing/Tarifs";
import {
  SLUG_FORMATION_PRINCIPALE,
  recupererChapitreGratuit,
  recupererCours,
} from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Flutter + Firebase pour débutants absolus — anis.dev",
  description:
    "Construis et publie une vraie application mobile avec Flutter et Firebase, en partant de zéro. Premier chapitre gratuit, sans compte payant.",
  openGraph: {
    title: "Flutter + Firebase pour débutants absolus",
    description:
      "Construis et publie une vraie application mobile avec Flutter et Firebase, en partant de zéro.",
    type: "website",
    locale: "fr_FR",
  },
  alternates: { canonical: "/" },
};

export default async function Landing() {
  const cours = await recupererCours(SLUG_FORMATION_PRINCIPALE);

  // La landing n'a de sens que si la formation existe et est publiée : sans elle,
  // il n'y a rien à vendre. Un cours dépublié ne doit pas laisser une page cassée.
  if (!cours) notFound();

  // Le chapitre à jouer dans le hero suit le flag `is_free` en base, jamais un slug
  // codé en dur (§4.4) : c'est le même flag que `Parcours` utilise pour dessiner le
  // parcours juste en dessous, donc les deux ne peuvent pas se contredire.
  const slugChapitreGratuit = cours.modules
    .flatMap((mod) => mod.chapters)
    .find((chapitre) => chapitre.is_free)?.slug;
  const chapitreGratuit = slugChapitreGratuit
    ? await recupererChapitreGratuit(slugChapitreGratuit)
    : null;

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        // Données structurées Course (schema.org). `cours.title`/`description` viennent
        // du back-office (§1 — l'admin publie le contenu), pas d'une saisie visiteur,
        // mais `JSON.stringify` seul ne protège pas contre un `</script>` littéral dans
        // le texte qui romprait hors du bloc JSON-LD : `<` est échappé en `<`.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Course",
            name: cours.title,
            description: cours.description,
            provider: { "@type": "Organization", name: "anis.dev" },
            inLanguage: "fr",
          }).replace(/</g, "\\u003c"),
        }}
      />

      <EnTeteMarketing />

      <main className="mx-auto w-full max-w-4xl px-5 sm:px-8">
        <section aria-labelledby="titre-hero" className="pt-6 sm:pt-10">
          <h1
            id="titre-hero"
            className="font-titre text-[length:var(--texte-5xl)] font-semibold tracking-tight"
          >
            {cours.title}
          </h1>
          <p className="mt-4 max-w-mesure text-[length:var(--texte-lg)] text-ink">
            {cours.description}
          </p>

          <div className="mt-10">
            {chapitreGratuit ? (
              <LecteurChapitre chapitre={chapitreGratuit} />
            ) : (
              <p className="text-[length:var(--texte-base)] text-ink">
                Le chapitre gratuit est momentanément indisponible.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="titre-programme" className="mt-20">
          <h2
            id="titre-programme"
            className="font-titre text-[length:var(--texte-2xl)] font-semibold"
          >
            Le programme
          </h2>
          <p className="mt-3 max-w-mesure text-[length:var(--texte-base)] text-ink">
            Module par module, chapitre par chapitre. Le premier chapitre est ouvert ; le
            reste s&apos;ouvre après ton inscription.
          </p>
          <div className="mt-8">
            <Parcours cours={cours} />
          </div>
        </section>

        <section aria-labelledby="titre-format" className="mt-20 border-t border-muted/40 py-16">
          <h2
            id="titre-format"
            className="font-titre text-[length:var(--texte-2xl)] font-semibold"
          >
            Comment ça se passe
          </h2>
          <dl className="mt-8 grid gap-8 sm:grid-cols-3">
            <div>
              <dt className="font-titre text-[length:var(--texte-base)] font-semibold">
                Vidéo + code
              </dt>
              <dd className="mt-2 text-[length:var(--texte-sm)] text-ink">
                Chaque chapitre est une leçon vidéo courte, avec le vrai code écrit à
                l&apos;écran — pas de diapositives.
              </dd>
            </div>
            <div>
              <dt className="font-titre text-[length:var(--texte-base)] font-semibold">
                QCM de fin de chapitre
              </dt>
              <dd className="mt-2 text-[length:var(--texte-sm)] text-ink">
                Un court QCM après chaque chapitre vérifie que tu as compris avant de
                continuer.
              </dd>
            </div>
            <div>
              <dt className="font-titre text-[length:var(--texte-base)] font-semibold">
                Examen de module
              </dt>
              <dd className="mt-2 text-[length:var(--texte-sm)] text-ink">
                À la fin de chaque module, un examen plus long avec un seuil de réussite.
              </dd>
            </div>
          </dl>
        </section>

        <Tarifs />
        <Faq />
      </main>
    </>
  );
}

import Link from "next/link";

import type { CoursPublic } from "@/lib/catalog-schemas";
import type { StatutInscription } from "@/lib/enrollment-schemas";

type Props = {
  cours: CoursPublic;
  statut: StatutInscription;
};

/* Le parcours vu par un compte connecté (§6).

   Trois états seulement à cette étape, parce que la progression n'existe pas encore
   (étape 5) : « en cours » (anneau safran) pour le chapitre gratuit d'un compte qui
   attend sa validation, « disponible » (contour ink) pour ce qui est ouvert, et
   « verrouillé » (opacité 45 %) pour ce qui attend le versement.

   Le safran ne sert qu'à dire « c'est ici que tu en es » — jamais à décorer. */

type EtatNoeud = "en-cours" | "disponible" | "verrouille";

const CLASSES_NOEUD: Record<EtatNoeud, string> = {
  "en-cours": "bg-paper ring-2 ring-safran",
  disponible: "bg-paper ring-[1.5px] ring-ink",
  verrouille: "bg-paper ring-[1.5px] ring-ink",
};

export function ParcoursEtudiant({ cours, statut }: Props) {
  const accesComplet = statut === "ACTIVE";

  return (
    <ol className="flex flex-col gap-10">
      {cours.modules.map((mod) => (
        <li key={mod.id}>
          <h3 className="font-titre text-[length:var(--texte-lg)] font-semibold text-ink">
            Module {mod.order} — {mod.title}
          </h3>
          {mod.summary ? (
            <p className="mt-1 max-w-mesure text-[length:var(--texte-sm)] text-ink">
              {mod.summary}
            </p>
          ) : null}

          <ol className="mt-4 flex flex-col gap-3 border-l border-muted/40 pl-6">
            {mod.chapters.map((chapitre) => {
              const ouvert = accesComplet || chapitre.is_free;
              const etat: EtatNoeud = !ouvert
                ? "verrouille"
                : !accesComplet && chapitre.is_free
                  ? "en-cours"
                  : "disponible";

              return (
                <li
                  key={chapitre.id}
                  className={`relative ${etat === "verrouille" ? "opacity-45" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full ${CLASSES_NOEUD[etat]}`}
                  />
                  {ouvert ? (
                    <Link
                      href={
                        accesComplet ? `/app/chapitre/${chapitre.slug}` : `/gratuit/${chapitre.slug}`
                      }
                      className="text-[length:var(--texte-base)] text-ink underline-offset-4 hover:underline"
                    >
                      {chapitre.title}
                      {etat === "en-cours" ? (
                        <span className="ml-2 text-[length:var(--texte-xs)] text-ink">
                          tu en es ici
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="text-[length:var(--texte-base)] text-ink">
                      {chapitre.title}
                      <span className="sr-only"> — ouvert après validation de ton versement</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

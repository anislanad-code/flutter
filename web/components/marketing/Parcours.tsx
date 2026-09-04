import Link from "next/link";

import type { CoursPublic } from "@/lib/catalog-schemas";

type Props = {
  cours: CoursPublic;
};

/* Chemin vertical par module, un nœud par chapitre (§6). Pas d'état "terminé" ni
   "en cours" ici : un visiteur anonyme n'a pas de progression. Deux états seulement —
   le chapitre gratuit (disponible) et le reste (recommandé après inscription, mais
   jamais un lien mort : CLAUDE.md §2 interdit le gating dur). */
export function Parcours({ cours }: Props) {
  return (
    <ol className="flex flex-col gap-10">
      {cours.modules.map((mod) => (
        <li key={mod.id}>
          <h3 className="font-titre text-[length:var(--texte-lg)] font-semibold">
            Module {mod.order} — {mod.title}
          </h3>
          {mod.summary ? (
            <p className="mt-1 max-w-mesure text-[length:var(--texte-sm)] text-muted">
              {mod.summary}
            </p>
          ) : null}

          <ol className="mt-4 flex flex-col gap-3 border-l border-muted/40 pl-6">
            {mod.chapters.map((chapitre) =>
              chapitre.is_free ? (
                <li key={chapitre.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full bg-paper ring-[1.5px] ring-ink"
                  />
                  <Link
                    href={`/gratuit/${chapitre.slug}`}
                    className="text-[length:var(--texte-base)] text-ink underline-offset-4 hover:underline"
                  >
                    {chapitre.title}{" "}
                    <span className="text-[length:var(--texte-xs)] text-zellige">— gratuit</span>
                  </Link>
                </li>
              ) : (
                <li key={chapitre.id} className="relative opacity-45">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full bg-paper ring-[1.5px] ring-ink"
                  />
                  <span
                    title="Réservé aux inscrits actifs"
                    className="text-[length:var(--texte-base)] text-ink"
                  >
                    {chapitre.title}
                  </span>
                </li>
              ),
            )}
          </ol>
        </li>
      ))}
    </ol>
  );
}

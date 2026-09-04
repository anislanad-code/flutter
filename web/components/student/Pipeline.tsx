import Link from "next/link";

import { NoeudPipeline } from "@/components/student/NoeudPipeline";
import type {
  EtatNoeud,
  Pipeline as PipelineData,
} from "@/lib/progress-schemas";

type Props = {
  pipeline: PipelineData;
  /** Slug du chapitre venant d'être marqué terminé, s'il y en a un (`?termine=`). */
  chapitreVientDeTerminer?: string;
};

/* Le pipeline d'un compte `ACTIVE` (§6) : chemin vertical en serpentin, groupé par
   module, quatre états calculés côté serveur. Un module « recommandé plus tard »
   reste entièrement cliquable — soft gating (§2), jamais un cadenas. */

const TEXTE_ETAT: Record<EtatNoeud, string> = {
  termine: "terminé",
  en_cours: "en cours",
  disponible: "disponible",
  recommande_plus_tard: "recommandé plus tard",
};

export function Pipeline({ pipeline, chapitreVientDeTerminer }: Props) {
  const auMoinsUnCommence = pipeline.modules.some((mod) =>
    mod.chapters.some((c) => c.state === "termine" || c.state === "en_cours"),
  );

  return (
    <div className="flex flex-col gap-8">
      {pipeline.resume_chapter_slug ? (
        <Link
          href={`/app/chapitre/${pipeline.resume_chapter_slug}`}
          className="self-start rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90"
        >
          {auMoinsUnCommence ? "Reprendre" : "Commencer"}
        </Link>
      ) : (
        <p className="text-[length:var(--texte-base)] text-zellige">
          Tous les chapitres disponibles sont terminés.
        </p>
      )}

      <ol className="flex flex-col gap-10">
        {pipeline.modules.map((mod) => {
          const pourcentage =
            mod.total_chapters > 0
              ? Math.round((mod.completed_chapters / mod.total_chapters) * 100)
              : 0;
          // Le module précédent qui, une fois terminé, déverrouillerait celui-ci —
          // jamais le module courant (§6 : « Passe d'abord l'examen du module N »
          // désigne toujours un module antérieur, pas celui qu'on ouvre).
          const recommandation =
            !mod.unlocked && mod.recommande_apres_ordre !== null
              ? `Termine d'abord le module ${mod.recommande_apres_ordre}.`
              : null;

          return (
            <li key={mod.id}>
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-titre text-[length:var(--texte-lg)] font-semibold text-ink">
                  Module {mod.order} — {mod.title}
                </h3>
                <span className="text-[length:var(--texte-xs)] text-muted">
                  {mod.completed_chapters}/{mod.total_chapters}
                </span>
              </div>

              <div
                role="progressbar"
                aria-valuenow={pourcentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progression du module ${mod.order}`}
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/20"
              >
                <div
                  className="h-full rounded-full bg-zellige"
                  style={{ width: `${pourcentage}%` }}
                />
              </div>

              {recommandation ? (
                <p className="mt-2 text-[length:var(--texte-xs)] text-muted">
                  {recommandation}
                </p>
              ) : null}

              <ol className="mt-4 flex flex-col gap-3 border-l border-muted/40 pl-6">
                {mod.chapters.map((chapitre) => (
                  <li
                    key={chapitre.id}
                    className={`relative ${
                      chapitre.state === "recommande_plus_tard"
                        ? "opacity-45"
                        : ""
                    }`}
                  >
                    <NoeudPipeline
                      state={chapitre.state}
                      vientDeTerminer={
                        chapitre.slug === chapitreVientDeTerminer
                      }
                    />
                    <Link
                      href={`/app/chapitre/${chapitre.slug}`}
                      className="text-[length:var(--texte-base)] text-ink underline-offset-4 hover:underline"
                    >
                      {chapitre.title}
                      <span className="sr-only">
                        {" "}
                        — {TEXTE_ETAT[chapitre.state]}
                      </span>
                      {chapitre.state === "en_cours" ? (
                        <span className="ml-2 text-[length:var(--texte-xs)] text-ink">
                          tu en es ici
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

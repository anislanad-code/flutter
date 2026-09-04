import { BoutonTerminerChapitre } from "@/components/course/BoutonTerminerChapitre";
import { LecteurSecurise } from "@/components/course/LecteurSecurise";
import type { Chapitre } from "@/lib/catalog-schemas";
import { analyserTranscript } from "@/lib/markdown-leger";

/* Rendu d'un chapitre, gratuit ou payant. Le composant ne décide **jamais** du droit
   d'y accéder : il affiche ce que le serveur a bien voulu lui donner. La règle du
   paywall vit dans Django (§4.4), et un chapitre payant n'arrive jusqu'ici que si
   l'API l'a déjà servi à un compte `ACTIVE`. */

type Props = {
  chapitre: Chapitre;
  /** Faux sur `/gratuit/[chapitre]` (visiteur anonyme, pas de progression à suivre) ;
   *  vrai sur `/app/chapitre/[chapitre]` (compte connecté, §5). */
  avecSuiviDeProgression?: boolean;
};

export function LecteurChapitre({
  chapitre,
  avecSuiviDeProgression = false,
}: Props) {
  const blocs = analyserTranscript(chapitre.lesson.transcript);

  return (
    <div className="flex flex-col gap-8">
      {/* Aucune URL n'est construite ici. Le lecteur demande un jeton signé au BFF
          (`POST /api/lessons/{id}/playback`) après hydratation, jamais pendant le SSR. */}
      <LecteurSecurise lessonId={chapitre.lesson.id} titre={chapitre.title} />

      <div className="flex flex-col gap-4">
        {blocs.map((bloc, index) => {
          if (bloc.type === "titre") {
            return (
              <h3
                key={index}
                className="mt-2 font-titre text-[length:var(--texte-xl)] font-semibold"
              >
                {bloc.texte}
              </h3>
            );
          }
          if (bloc.type === "code") {
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded bg-ink p-4 text-[length:var(--texte-sm)] text-paper"
              >
                <code>{bloc.texte}</code>
              </pre>
            );
          }
          return (
            <p
              key={index}
              className="max-w-mesure text-[length:var(--texte-base)] text-ink"
            >
              {bloc.texte}
            </p>
          );
        })}
      </div>

      {chapitre.lesson.resources.length > 0 ? (
        <div className="border-t border-muted/40 pt-6">
          <h3 className="font-titre text-[length:var(--texte-lg)] font-semibold">
            Ressources
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {chapitre.lesson.resources.map((ressource) => (
              <li key={ressource.url}>
                <a
                  href={ressource.url}
                  className="text-zellige underline underline-offset-4"
                  rel="noreferrer"
                >
                  {ressource.titre}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {avecSuiviDeProgression ? (
        <div className="border-t border-muted/40 pt-6">
          <BoutonTerminerChapitre chapitreSlug={chapitre.slug} />
        </div>
      ) : null}
    </div>
  );
}

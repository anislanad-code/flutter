import type { EtatNoeud } from "@/lib/progress-schemas";

type Props = {
  state: EtatNoeud;
  /** Vrai une seule fois, juste après l'appel de complétion (§6) : joue l'unique
   *  animation de l'app. Calculé côté serveur depuis `?termine=<slug>` — pas de
   *  stockage navigateur, interdit hors authentification par CLAUDE.md §4.2. */
  vientDeTerminer?: boolean;
};

const CLASSES_NOEUD: Record<EtatNoeud, string> = {
  termine: "bg-zellige ring-2 ring-zellige",
  en_cours: "bg-paper ring-2 ring-safran",
  disponible: "bg-paper ring-[1.5px] ring-ink",
  recommande_plus_tard: "bg-paper ring-[1.5px] ring-ink",
};

export function NoeudPipeline({ state, vientDeTerminer = false }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`absolute -left-[1.6rem] top-1 flex h-3 w-3 items-center justify-center rounded-full ${CLASSES_NOEUD[state]} ${
        state === "termine" && vientDeTerminer ? "noeud-vient-de-terminer" : ""
      }`}
    >
      {state === "termine" ? (
        <svg viewBox="0 0 12 12" className="h-2 w-2" fill="none">
          <path
            d="M2.5 6.2l2.2 2.2 4.8-4.8"
            stroke="var(--paper)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  chapitreSlug: string;
};

/* Un bouton dit ce qu'il fait, le message de succès reprend le même verbe (§6).
   Le retour vers `/app?termine=<slug>` signale au pipeline quel nœud vient de passer
   à `terminé`, pour jouer l'unique animation de l'app — en paramètre d'URL, jamais en
   stockage navigateur (interdit hors authentification par CLAUDE.md §4.2). */
export function BoutonTerminerChapitre({ chapitreSlug }: Props) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "en_cours" | "termine" | "erreur">(
    "repos",
  );

  async function marquerTermine(): Promise<void> {
    setEtat("en_cours");
    try {
      const reponse = await fetch(
        `/api/chapters/${encodeURIComponent(chapitreSlug)}/complete`,
        {
          method: "POST",
        },
      );
      if (!reponse.ok) {
        setEtat("erreur");
        return;
      }
      setEtat("termine");
      router.push(`/app?termine=${encodeURIComponent(chapitreSlug)}`);
    } catch {
      setEtat("erreur");
    }
  }

  if (etat === "termine") {
    return (
      <p className="text-[length:var(--texte-base)] text-zellige">
        Chapitre marqué terminé.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={marquerTermine}
        disabled={etat === "en_cours"}
        className="self-start rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {etat === "en_cours"
          ? "Enregistrement…"
          : "Marquer ce chapitre comme terminé"}
      </button>
      {etat === "erreur" ? (
        <p className="text-[length:var(--texte-sm)] text-danger">
          Impossible d&apos;enregistrer pour l&apos;instant. Réessaie dans un
          instant.
        </p>
      ) : null}
    </div>
  );
}

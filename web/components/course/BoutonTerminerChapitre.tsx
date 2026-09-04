"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  chapitreSlug: string;
  /** Le pipeline dit déjà ce chapitre `termine` au chargement de la page : le bouton
   *  ne se propose pas de le refaire, et l'animation de complétion ne rejoue pas. */
  dejaTermine?: boolean;
};

/* Un bouton dit ce qu'il fait, le message de succès reprend le même verbe (§6).
   Le retour vers `/app?termine=<slug>` signale au pipeline quel nœud vient de passer
   à `terminé`, pour jouer l'unique animation de l'app — en paramètre d'URL, jamais en
   stockage navigateur (interdit hors authentification par CLAUDE.md §4.2). */
export function BoutonTerminerChapitre({
  chapitreSlug,
  dejaTermine = false,
}: Props) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "en_cours" | "termine" | "erreur">(
    dejaTermine ? "termine" : "repos",
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
      if (reponse.status === 401) {
        // La session a expiré pendant la lecture (un chapitre dépasse souvent les
        // 15 min de l'access token) : « réessaie » serait un conseil faux, puisque
        // réessayer échouerait pareil. On renvoie vers la connexion en conservant la
        // destination, comme partout ailleurs dans l'espace étudiant.
        router.push(
          `/connexion?suite=${encodeURIComponent(`/app/chapitre/${chapitreSlug}`)}`,
        );
        return;
      }
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
      <p role="status" className="text-[length:var(--texte-base)] text-zellige">
        {dejaTermine
          ? "Chapitre déjà marqué terminé."
          : "Chapitre marqué terminé."}
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
        <p role="alert" className="text-[length:var(--texte-sm)] text-danger">
          Impossible d&apos;enregistrer pour l&apos;instant. Réessaie dans un
          instant.
        </p>
      ) : null}
    </div>
  );
}

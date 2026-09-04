"use client";

/* Placeholder « vidéo à venir ». La lecture réelle passe par LecteurSecurise
   (jeton signé, filigrane). Ce composant n'est plus branché sur une URL de fichier. */

type Props = {
  src: string | null;
  titre: string;
};

export function LecteurVideo({ src, titre }: Props) {
  if (!src) {
    return (
      <div
        role="img"
        aria-label={`Vidéo de « ${titre} » à venir`}
        className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-ink px-6 text-center text-paper"
      >
        <p className="font-code text-[length:var(--texte-sm)] text-paper/70">
          $ vidéo en tournage —
        </p>
        <p className="max-w-mesure text-[length:var(--texte-base)]">
          La vidéo de ce chapitre arrive bientôt. En attendant, lis-le juste en dessous :
          le contenu est le même.
        </p>
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      controlsList="nodownload"
      onContextMenu={(evenement) => evenement.preventDefault()}
      className="aspect-video w-full rounded-lg bg-ink"
      aria-label={titre}
    >
      Ton navigateur ne sait pas lire cette vidéo.
    </video>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const TAILLE_MAX_OCTETS = 5 * 1024 * 1024;
const TYPES_ACCEPTES = ["image/jpeg", "image/png", "application/pdf"];

type Props = {
  montantAttendu: number;
};

/* Dépôt du reçu. Les contrôles faits ici (taille, type déclaré) ne servent qu'à donner
   une réponse immédiate : ils sont refaits, et par magic bytes, côté Django, qui est le
   seul à décider (§4.5). Ne jamais les considérer comme une frontière de sécurité. */
export function FormulaireRecu({ montantAttendu }: Props) {
  const router = useRouter();
  const champFichier = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [montant, setMontant] = useState(String(montantAttendu));
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  // `URL.createObjectURL` réserve de la mémoire tant qu'on ne la révoque pas.
  useEffect(() => {
    if (!fichier || !fichier.type.startsWith("image/")) {
      setApercu(null);
      return;
    }
    const url = URL.createObjectURL(fichier);
    setApercu(url);
    return () => URL.revokeObjectURL(url);
  }, [fichier]);

  function choisir(evenement: React.ChangeEvent<HTMLInputElement>) {
    setErreur(null);
    const choisi = evenement.target.files?.[0] ?? null;
    if (!choisi) {
      setFichier(null);
      return;
    }
    if (choisi.size > TAILLE_MAX_OCTETS) {
      setFichier(null);
      setErreur("Ce fichier dépasse 5 Mo. Envoie une capture d'écran plutôt qu'une photo brute.");
      return;
    }
    if (!TYPES_ACCEPTES.includes(choisi.type)) {
      setFichier(null);
      setErreur("Formats acceptés : JPEG, PNG ou PDF.");
      return;
    }
    setFichier(choisi);
  }

  async function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!fichier) {
      setErreur("Choisis d'abord la capture de ton reçu.");
      return;
    }

    setEnCours(true);
    setErreur(null);
    try {
      const corps = new FormData();
      corps.append("file", fichier);
      corps.append("amount_declared", montant);

      const reponse = await fetch("/api/enrollment/proof", { method: "POST", body: corps });
      const donnees = await reponse.json().catch(() => ({}));

      if (!reponse.ok) {
        setErreur(
          typeof donnees.detail === "string"
            ? donnees.detail
            : "Le reçu n'a pas pu être envoyé. Réessaie.",
        );
        return;
      }

      setFichier(null);
      if (champFichier.current) champFichier.current.value = "";
      router.refresh();
    } catch {
      setErreur("Impossible de contacter le serveur. Vérifie ta connexion.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={envoyer} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="montant" className="text-[length:var(--texte-sm)] font-medium text-ink">
          Montant versé, en dinars
        </label>
        <input
          id="montant"
          name="montant"
          type="number"
          inputMode="numeric"
          min={1}
          value={montant}
          onChange={(evenement) => setMontant(evenement.target.value)}
          className="w-40 rounded border border-muted bg-paper px-3 py-2.5 text-[length:var(--texte-base)] tabular-nums text-ink outline-none focus-visible:border-zellige focus-visible:ring-2 focus-visible:ring-zellige/40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="recu" className="text-[length:var(--texte-sm)] font-medium text-ink">
          Capture du reçu
        </label>
        <input
          ref={champFichier}
          id="recu"
          name="recu"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={choisir}
          aria-describedby="recu-aide"
          className="rounded border border-muted bg-paper px-3 py-2.5 text-[length:var(--texte-sm)] text-ink outline-none file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[length:var(--texte-sm)] file:text-paper focus-visible:border-zellige focus-visible:ring-2 focus-visible:ring-zellige/40"
        />
        <p id="recu-aide" className="text-[length:var(--texte-sm)] text-ink">
          JPEG, PNG ou PDF, 5 Mo maximum. Le montant et la date doivent être lisibles.
        </p>
      </div>

      {apercu ? (
        <figure className="flex flex-col gap-2">
          {/* `next/image` optimise des URLs distantes ; ici la source est un blob local
              qui n'existe que dans cet onglet et n'a rien à optimiser. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={apercu}
            alt="Aperçu du reçu que tu vas envoyer"
            className="max-h-72 w-auto rounded border border-muted/40 object-contain"
          />
          <figcaption className="text-[length:var(--texte-sm)] text-ink">
            Vérifie que le montant et la date se lisent bien avant d&apos;envoyer.
          </figcaption>
        </figure>
      ) : null}

      {fichier && !apercu ? (
        <p className="text-[length:var(--texte-sm)] text-ink">
          Fichier prêt : {fichier.name}
        </p>
      ) : null}

      {erreur ? (
        <p role="alert" className="text-[length:var(--texte-sm)] text-danger">
          {erreur}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enCours}
        className="self-start rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {enCours ? "Envoi du reçu…" : "Envoyer le reçu"}
      </button>
    </form>
  );
}

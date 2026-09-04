"use client";

import { useRef, useState } from "react";

import { ChampTexte } from "@/components/auth/ChampTexte";

export function FormulaireListeAttente() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Honeypot : un champ humainement invisible qu'un bot remplit souvent quand même.
  const [site, setSite] = useState("");
  const rendueA = useRef(Date.now());
  const [enCours, setEnCours] = useState(false);
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState("");

  async function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnCours(true);
    setErreur("");

    try {
      const reponse = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, site, form_rendered_at: rendueA.current }),
      });

      if (reponse.status === 429) {
        setErreur("Trop de tentatives. Réessaie dans un moment.");
        return;
      }
      if (!reponse.ok) {
        setErreur("Vérifie ton adresse email.");
        return;
      }
      setEnvoye(true);
    } catch {
      setErreur("La connexion a échoué. Réessaie.");
    } finally {
      setEnCours(false);
    }
  }

  if (envoye) {
    return (
      <p className="text-[length:var(--texte-base)] text-ink">
        Inscrit·e à la liste d&apos;attente. On te préviendra dès l&apos;ouverture des
        prochaines places.
      </p>
    );
  }

  return (
    <form onSubmit={envoyer} className="flex flex-col gap-4 sm:flex-row sm:items-end" noValidate>
      <input
        type="text"
        name="site"
        value={site}
        onChange={(evenement) => setSite(evenement.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute h-0 w-0 opacity-0"
      />
      <div className="flex-1">
        <ChampTexte
          id="liste-attente-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
      </div>
      <div className="flex-1">
        <ChampTexte
          id="liste-attente-telephone"
          label="Téléphone"
          type="tel"
          autoComplete="tel"
          requis={false}
          value={phone}
          onChange={setPhone}
        />
      </div>
      <button
        type="submit"
        disabled={enCours}
        className="rounded bg-zellige px-5 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {enCours ? "Envoi…" : "Rejoindre la liste d'attente"}
      </button>
      {erreur ? (
        <p role="alert" className="text-[length:var(--texte-sm)] text-danger sm:basis-full">
          {erreur}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useState } from "react";

import { ChampTexte } from "@/components/auth/ChampTexte";

export function FormulaireMotDePasseOublie() {
  const [email, setEmail] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [envoye, setEnvoye] = useState(false);

  async function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnCours(true);

    try {
      await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Ignoré volontairement : même écran de succès quoi qu'il arrive (voir plus bas).
    } finally {
      // Même comportement que la réponse échoue ou réussisse : rien ne doit distinguer
      // un email inconnu d'un email connu (§4.2).
      setEnvoye(true);
      setEnCours(false);
    }
  }

  if (envoye) {
    return (
      <p className="text-[length:var(--texte-base)] text-ink">
        Si un compte existe pour cet email, un lien de réinitialisation vient d&apos;être
        envoyé. Vérifie ta boîte mail.
      </p>
    );
  }

  return (
    <form onSubmit={envoyer} className="flex flex-col gap-5" noValidate>
      <ChampTexte
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
      />

      <button
        type="submit"
        disabled={enCours}
        className="rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {enCours ? "Envoi…" : "Envoyer le lien"}
      </button>
    </form>
  );
}

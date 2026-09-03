"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ChampTexte } from "@/components/auth/ChampTexte";

export function FormulaireNouveauMotDePasse() {
  const router = useRouter();
  const parametres = useSearchParams();
  const token = parametres.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnCours(true);
    setErreur(null);

    try {
      const reponse = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (reponse.status === 429) {
        setErreur("Trop de tentatives. Réessaie dans quelques minutes.");
        return;
      }
      if (!reponse.ok) {
        const corps = await reponse.json().catch(() => ({}));
        setErreur(
          Array.isArray(corps.password)
            ? corps.password.join(" ")
            : "Ce lien n'est plus valable. Demande-en un nouveau.",
        );
        return;
      }

      router.push("/connexion");
    } catch {
      setErreur("Impossible de contacter le serveur. Vérifie ta connexion.");
    } finally {
      setEnCours(false);
    }
  }

  if (!token) {
    return (
      <p role="alert" className="text-[length:var(--texte-base)] text-danger">
        Ce lien est incomplet. Redemande une réinitialisation depuis la page « mot de passe
        oublié ».
      </p>
    );
  }

  return (
    <form onSubmit={envoyer} className="flex flex-col gap-5" noValidate>
      <ChampTexte
        id="password"
        label="Nouveau mot de passe"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        erreur={erreur ?? undefined}
      />
      <p className="text-[length:var(--texte-sm)] text-muted">
        Au moins 10 caractères, pas un mot de passe courant.
      </p>

      <button
        type="submit"
        disabled={enCours}
        className="rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {enCours ? "Enregistrement…" : "Changer le mot de passe"}
      </button>
    </form>
  );
}

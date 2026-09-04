"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BoutonDeconnexion() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);

  async function deconnecter() {
    setEnCours(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignoré volontairement : on redirige quand même (voir plus bas).
    } finally {
      router.push("/connexion");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={deconnecter}
      disabled={enCours}
      className="rounded border border-muted px-4 py-2 text-[length:var(--texte-sm)] font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-60"
    >
      {enCours ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}

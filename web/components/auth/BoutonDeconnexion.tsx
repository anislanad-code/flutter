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
      className="rounded border border-muted/50 px-4 py-2 text-[length:var(--texte-sm)] font-medium text-ink transition-opacity hover:opacity-80 disabled:opacity-60"
    >
      {enCours ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}

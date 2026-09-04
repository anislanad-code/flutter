"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ChampTexte } from "@/components/auth/ChampTexte";

/* `//evil.example` commence par "/" mais résout en URL relative au protocole — une
   redirection ouverte vers un domaine tiers après authentification (§4.2, esprit :
   ne jamais offrir de tremplin à la prise de contrôle de compte). Un chemin interne
   sûr commence par un seul "/", jamais par "//" ni par "/\". */
function destinationSure(suite: string | null): string {
  if (!suite) return "/app";
  if (!suite.startsWith("/")) return "/app";
  if (suite.startsWith("//") || suite.startsWith("/\\")) return "/app";
  return suite;
}

export function FormulaireConnexion() {
  const router = useRouter();
  const parametres = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnCours(true);
    setErreur(null);

    try {
      const reponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (reponse.status === 429) {
        setErreur("Trop de tentatives. Réessaie dans quelques minutes.");
        return;
      }
      if (!reponse.ok) {
        setErreur("Email ou mot de passe incorrect.");
        return;
      }

      router.push(destinationSure(parametres.get("suite")));
      router.refresh();
    } catch {
      setErreur("Impossible de contacter le serveur. Vérifie ta connexion.");
    } finally {
      setEnCours(false);
    }
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
      <ChampTexte
        id="password"
        label="Mot de passe"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />

      {erreur ? (
        <p role="alert" className="text-[length:var(--texte-sm)] text-danger">
          {erreur}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enCours}
        className="rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {enCours ? "Connexion…" : "Se connecter"}
      </button>

      <a
        href="/mot-de-passe-oublie"
        className="text-center text-[length:var(--texte-sm)] text-zellige underline underline-offset-4"
      >
        Mot de passe oublié
      </a>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ChampTexte } from "@/components/auth/ChampTexte";

export function FormulaireInscription() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreurGenerale, setErreurGenerale] = useState<string | null>(null);
  const [erreurMotDePasse, setErreurMotDePasse] = useState<string | null>(null);
  const [messageInfo, setMessageInfo] = useState<string | null>(null);

  async function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnCours(true);
    setErreurGenerale(null);
    setErreurMotDePasse(null);
    setMessageInfo(null);

    try {
      const reponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, password }),
      });
      const corps = await reponse.json().catch(() => ({}));

      if (reponse.status === 400 && Array.isArray(corps.password)) {
        setErreurMotDePasse(corps.password.join(" "));
        return;
      }
      if (reponse.status === 429) {
        setErreurGenerale("Trop de tentatives. Réessaie dans quelques minutes.");
        return;
      }
      if (!reponse.ok) {
        setErreurGenerale("Le compte n'a pas pu être créé. Réessaie.");
        return;
      }

      // L'inscription ne connecte jamais automatiquement (§4.2 — voir le commentaire
      // de app/api/auth/register/route.ts) : on enchaîne une vraie connexion avec les
      // identifiants du formulaire. Si l'email appartenait déjà à quelqu'un d'autre,
      // cette connexion échoue simplement — sans jamais le dire autrement qu'un échec
      // de connexion ordinaire.
      const connexion = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!connexion.ok) {
        // Pas une erreur : le compte est bien créé, seule la connexion automatique a
        // échoué (typiquement parce que l'email appartenait déjà à quelqu'un d'autre).
        setMessageInfo("Compte créé. Connecte-toi pour continuer.");
        return;
      }

      router.push("/app");
      router.refresh();
    } catch {
      setErreurGenerale("Impossible de contacter le serveur. Vérifie ta connexion.");
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
        id="phone"
        label="Téléphone"
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={setPhone}
        requis={false}
      />
      <ChampTexte
        id="password"
        label="Mot de passe"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        erreur={erreurMotDePasse ?? undefined}
      />
      <p className="text-[length:var(--texte-sm)] text-ink">
        Au moins 10 caractères, pas un mot de passe courant.
      </p>

      {erreurGenerale ? (
        <p role="alert" className="text-[length:var(--texte-sm)] text-danger">
          {erreurGenerale}
        </p>
      ) : null}
      {messageInfo ? (
        <p role="status" className="text-[length:var(--texte-sm)] text-zellige">
          {messageInfo}{" "}
          <a href="/connexion" className="underline underline-offset-4">
            Se connecter
          </a>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enCours}
        className="rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {enCours ? "Création du compte…" : "Créer mon compte"}
      </button>
    </form>
  );
}

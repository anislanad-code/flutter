import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";
import { ACCESS_COOKIE } from "@/lib/auth-cookie-names";

function requete(url: string, cookie?: string): NextRequest {
  const headers = cookie ? { cookie } : undefined;
  return new NextRequest(new Request(url, { headers }));
}

describe("middleware — protection de /app et /admin (étape 1)", () => {
  it("redirige vers /connexion quand /app est visité sans cookie de session", () => {
    const reponse = middleware(requete("https://anis.dev/app"));

    expect(reponse.status).toBe(307);
    const cible = new URL(reponse.headers.get("location") ?? "");
    expect(cible.pathname).toBe("/connexion");
    expect(cible.searchParams.get("suite")).toBe("/app");
  });

  it("redirige vers /connexion pour un sous-chemin de /app", () => {
    const reponse = middleware(requete("https://anis.dev/app/module-1"));

    expect(new URL(reponse.headers.get("location") ?? "").pathname).toBe("/connexion");
  });

  it("redirige vers /connexion quand /admin est visité sans cookie de session", () => {
    const reponse = middleware(requete("https://anis.dev/admin"));

    expect(new URL(reponse.headers.get("location") ?? "").pathname).toBe("/connexion");
  });

  it("laisse passer /app quand le cookie de session est présent", () => {
    const reponse = middleware(requete("https://anis.dev/app", `${ACCESS_COOKIE}=un-jeton`));

    expect(reponse.status).not.toBe(307);
    expect(reponse.headers.get("location")).toBeNull();
  });

  it("ne protège pas les routes publiques", () => {
    const reponse = middleware(requete("https://anis.dev/connexion"));

    expect(reponse.status).not.toBe(307);
  });

  it("ne confond pas /app avec un chemin qui commence pareil", () => {
    const reponse = middleware(requete("https://anis.dev/appareil"));

    expect(reponse.status).not.toBe(307);
  });
});

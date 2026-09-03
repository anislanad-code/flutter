import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

/* `next/font/google` télécharge les polices au build : en test on le neutralise et on
   vérifie ce qui nous intéresse — la langue, les trois variables de police (§6),
   l'absence de tout script tiers dans le squelette, et la lecture du nonce de CSP. */
vi.mock("next/font/google", () => {
  const fabrique = (variable: string) => () => ({ variable, className: variable });
  return {
    Bricolage_Grotesque: fabrique("var-bricolage"),
    Public_Sans: fabrique("var-public-sans"),
    JetBrains_Mono: fabrique("var-jetbrains"),
  };
});
vi.mock("../app/globals.css", () => ({}));

const enTetes = vi.hoisted(() => new Map<string, string>([["x-nonce", "nonce-de-test"]]));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: (cle: string) => enTetes.get(cle) ?? null }),
}));

const { default: RootLayout, metadata } = await import("@/app/layout");

let html = "";

beforeAll(async () => {
  /* Le layout est asynchrone depuis qu'il lit le nonce : c'est cette lecture qui
     bascule le rendu en dynamique, sans quoi la CSP tue les scripts en production. */
  html = renderToStaticMarkup(
    await RootLayout({ children: createElement("p", null, "contenu") }),
  );
});

describe("RootLayout", () => {
  it("déclare la langue française sur <html> (§6 : français uniquement)", () => {
    expect(html).toContain('lang="fr"');
  });

  it("expose les trois familles de polices du §6 en variables", () => {
    for (const variable of ["var-bricolage", "var-public-sans", "var-jetbrains"]) {
      expect(html).toContain(variable);
    }
  });

  it("rend les enfants dans le body", () => {
    expect(html).toContain("<p>contenu</p>");
  });

  it("lit le nonce de la requête et le publie pour Next", () => {
    expect(html).toContain('name="csp-nonce"');
    expect(html).toContain("nonce-de-test");
  });

  it("n'injecte aucun script ni ressource tierce dans le squelette", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("porte des métadonnées de marque, sans mention d'une formation en dur", () => {
    expect(String(metadata.title)).toContain("anis.dev");
    expect(String(metadata.description)).not.toBe("");
  });
});

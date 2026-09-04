import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { config, middleware } from "@/middleware";

/* CSP à nonce (CLAUDE.md §4.6). La règle non négociable : `script-src` ne contient
   jamais `'unsafe-inline'`, et le nonce change à chaque requête — sinon il ne sert à rien. */

function requete(url = "https://anis.dev/"): NextRequest {
  return new NextRequest(new Request(url));
}

function csp(url?: string): string {
  return middleware(requete(url)).headers.get("Content-Security-Policy") ?? "";
}

function directive(politique: string, nom: string): string | undefined {
  return politique
    .split(";")
    .map((partie) => partie.trim())
    .find((partie) => partie === nom || partie.startsWith(`${nom} `));
}

describe("middleware — en-tête CSP", () => {
  it("pose un Content-Security-Policy sur la réponse", () => {
    expect(csp()).not.toBe("");
  });

  it("propage le nonce à la requête via x-nonce, identique à celui de la CSP", () => {
    const reponse = middleware(requete());
    const politique = reponse.headers.get("Content-Security-Policy") ?? "";
    const nonceCsp = /'nonce-([^']+)'/.exec(politique)?.[1];

    expect(nonceCsp).toBeDefined();
    expect(nonceCsp).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    /* Next relit ces deux en-têtes de requête pour tamponner ses propres <script>.
       S'ils ne descendent pas, 'strict-dynamic' bloque toute la page. */
    expect(reponse.headers.get("x-middleware-request-x-nonce")).toBe(nonceCsp);
    expect(reponse.headers.get("x-middleware-request-content-security-policy")).toBe(
      politique,
    );
    expect(reponse.headers.get("x-middleware-override-headers")).toContain("x-nonce");
  });

  it("génère un nonce différent à chaque requête", () => {
    const nonces = new Set(
      Array.from({ length: 25 }, () => /'nonce-([^']+)'/.exec(csp())?.[1]),
    );

    expect(nonces.size).toBe(25);
    expect(nonces.has(undefined)).toBe(false);
  });

  it("n'autorise jamais 'unsafe-inline' dans script-src", () => {
    expect(directive(csp(), "script-src")).not.toContain("'unsafe-inline'");
  });

  it("utilise 'strict-dynamic' pour couvrir le chargement en cascade de Next", () => {
    expect(directive(csp(), "script-src")).toContain("'strict-dynamic'");
  });

  it.each([
    ["default-src", "default-src 'self'"],
    ["frame-ancestors", "frame-ancestors 'none'"],
    ["object-src", "object-src 'none'"],
    ["base-uri", "base-uri 'self'"],
    ["form-action", "form-action 'self'"],
    ["frame-src", "frame-src 'none'"],
    ["upgrade-insecure-requests", "upgrade-insecure-requests"],
  ])("déclare %s", (nom, attendu) => {
    expect(directive(csp(), nom)).toBe(attendu);
  });

  it("n'ouvre aucune frame tierce avant l'étape 4 (Bunny ajouté explicitement)", () => {
    expect(csp()).not.toContain("bunny");
    expect(csp()).not.toContain("*");
  });

  it("interdit les origines tierces pour connect-src et img-src reste borné", () => {
    const politique = csp();
    expect(directive(politique, "connect-src")).toBe("connect-src 'self'");
    expect(directive(politique, "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(politique, "font-src")).toBe("font-src 'self'");
  });

  it("applique la même politique quel que soit le chemin demandé", () => {
    const a = csp("https://anis.dev/app/module-1").replace(/'nonce-[^']+'/, "N");
    const b = csp("https://anis.dev/admin").replace(/'nonce-[^']+'/, "N");

    expect(a).toBe(b);
  });

  it("ne recopie aucun en-tête CSP fourni par le client", () => {
    const brute = new Request("https://anis.dev/", {
      headers: { "Content-Security-Policy": "default-src *" },
    });

    const politique =
      middleware(new NextRequest(brute)).headers.get("Content-Security-Policy") ?? "";

    expect(politique).not.toContain("default-src *");
    expect(politique).toContain("default-src 'self'");
  });
});

describe("middleware — assouplissements de développement", () => {
  it("n'ouvre 'unsafe-eval' et les websockets qu'en développement", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    const dev = await import("@/middleware");

    const politique =
      dev.middleware(requete()).headers.get("Content-Security-Policy") ?? "";

    expect(directive(politique, "script-src")).toContain("'unsafe-eval'");
    expect(directive(politique, "connect-src")).toContain("ws:");
    // Même en dev, l'inline sans nonce reste interdit.
    expect(directive(politique, "script-src")).not.toContain("'unsafe-inline'");

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ferme 'unsafe-eval' et les websockets en production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const prod = await import("@/middleware");

    const politique =
      prod.middleware(requete()).headers.get("Content-Security-Policy") ?? "";

    expect(directive(politique, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(politique, "connect-src")).toBe("connect-src 'self'");

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("middleware — portée", () => {
  it("exclut les fichiers statiques et le favicon du matcher", () => {
    const source = config.matcher[0] ?? "";

    expect(source).toContain("_next/static");
    expect(source).toContain("_next/image");
    expect(source).toContain("favicon.ico");
    expect(source).toContain("api/admin/proofs/");
  });

  it("ne conditionne sa portée à aucun en-tête de requête", () => {
    /* Les conditions `missing` sur `next-router-prefetch` et `purpose: prefetch`
       portaient sur des en-têtes qu'un client pose lui-même : `curl -H "purpose:
       prefetch" /` renvoyait le document entier sans CSP. Constaté par la porte de
       sécurité de l'étape 0, ÉLEVÉ-E1. */
    for (const entree of config.matcher) {
      expect(typeof entree).toBe("string");
    }
    expect(JSON.stringify(config.matcher)).not.toContain("missing");
    expect(JSON.stringify(config.matcher)).not.toContain("prefetch");
  });
});

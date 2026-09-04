import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/* Invariante de CLAUDE.md §4.2, à rejouer à chaque étape : les cookies d'authentification
   portent httpOnly, Secure et SameSite=Strict, et rien d'autre que le BFF ne les écrit.
   Le test passe par le vrai `Set-Cookie` sérialisé, pas par l'objet d'options : c'est ce
   que le navigateur reçoit qui compte. */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const SESSION_OK = {
  access_token: "acces-123",
  access_token_expires_in: 900,
  refresh_token: "11111111-1111-1111-1111-111111111111.secret",
  refresh_token_expires_in: 604800,
  user: {
    id: 1,
    email: "etudiante@example.com",
    phone: "",
    is_staff: false,
    created_at: "2026-01-01T00:00:00Z",
    last_activity_at: null,
  },
};

function requeteLogin(): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.c", password: "x" }),
    }),
  );
}

/** Rejoue le module de cookies avec un NODE_ENV donné (il lit l'env à l'import). */
async function setCookiesEnProd(prod: boolean): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", prod ? "production" : "test");
  const { POST: login } = await import("@/app/api/auth/login/route");
  apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_OK });
  const reponse = await login(requeteLogin());
  return reponse.headers.getSetCookie();
}

beforeEach(() => {
  apiFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("invariante §4.2 — flags des cookies d'authentification", () => {
  it("en production : httpOnly + Secure + SameSite=Strict sur les deux cookies", async () => {
    const cookies = await setCookiesEnProd(true);

    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=strict");
      expect(cookie).toContain("Path=/");
    }
    expect(cookies.some((c) => c.startsWith("session="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("refresh="))).toBe(true);
  });

  it("hors production : Secure retombe (http://localhost), le reste tient", async () => {
    const cookies = await setCookiesEnProd(false);

    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=strict");
      expect(cookie).not.toContain("Secure");
    }
  });

  it("les durées de vie suivent celles annoncées par Django (15 min / 7 jours)", async () => {
    const cookies = await setCookiesEnProd(true);
    const session = cookies.find((c) => c.startsWith("session="));
    const refresh = cookies.find((c) => c.startsWith("refresh="));

    expect(session).toContain("Max-Age=900");
    expect(refresh).toContain("Max-Age=604800");
  });

  it("aucun token brut n'est renvoyé dans le corps JSON", async () => {
    vi.resetModules();
    const { POST: login } = await import("@/app/api/auth/login/route");
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_OK });

    const reponse = await login(requeteLogin());
    const corps = JSON.stringify(await reponse.json());

    expect(corps).not.toContain(SESSION_OK.access_token);
    expect(corps).not.toContain(SESSION_OK.refresh_token);
    expect(corps).toContain("etudiante@example.com");
  });

  it("effacerCookiesAuth vide les deux cookies avec Max-Age=0", async () => {
    vi.resetModules();
    const { effacerCookiesAuth } = await import("@/lib/auth-cookies");
    const reponse = NextResponse.json({});
    effacerCookiesAuth(reponse);

    const cookies = reponse.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("Path=/");
    }
  });
});

describe("invariante §4.2 — aucun stockage navigateur", () => {
  it("aucun fichier de web/ n'écrit dans localStorage ou sessionStorage", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const fichiers: string[] = [];
    const parcourir = (repertoire: string): void => {
      for (const entree of readdirSync(repertoire)) {
        if (entree === "node_modules" || entree === ".next" || entree.startsWith(".")) continue;
        const chemin = join(repertoire, entree);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.(ts|tsx)$/.test(entree) && !chemin.includes("/tests/")) fichiers.push(chemin);
      }
    };
    for (const racine of ["app", "components", "lib"]) parcourir(racine);

    expect(fichiers.length).toBeGreaterThan(10);
    for (const fichier of fichiers) {
      const source = readFileSync(fichier, "utf8");
      expect(source, `${fichier} touche au stockage navigateur`).not.toMatch(
        /localStorage|sessionStorage|document\.cookie/,
      );
    }
  });
});

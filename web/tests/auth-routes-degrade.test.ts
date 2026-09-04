import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* Complément de `auth-routes.test.ts` : les chemins dégradés que le premier fichier ne
   traversait pas. Deux familles, toutes deux critiques pour le §4.2 :
   — Django injoignable (503) : le BFF ne doit jamais laisser fuiter l'URL interne, ni
     poser de cookie, ni transformer la panne en « identifiants incorrects » persistants ;
   — réponse de Django dont la forme ne correspond pas au schéma Zod (502) : le front ne
     fait jamais confiance à la forme des données, et surtout n'écrit pas de cookie
     d'authentification à partir d'un corps qu'il n'a pas validé. */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: register } = await import("@/app/api/auth/register/route");
const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: refresh } = await import("@/app/api/auth/refresh/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { POST: logoutAll } = await import("@/app/api/auth/logout-all/route");
const { POST: resetConfirm } = await import("@/app/api/auth/password-reset/confirm/route");
const { GET: me } = await import("@/app/api/me/route");

function requeteJson(url: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(
    new Request(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: cookie ? { cookie } : undefined,
    }),
  );
}

function requeteBrute(url: string, corps: string): NextRequest {
  return new NextRequest(new Request(url, { method: "POST", body: corps }));
}

/** Le corps JSON réellement transmis à Django lors du n-ième appel. */
function corpsTransmis(index = 0): unknown {
  const appel = apiFetch.mock.calls.at(index);
  if (!appel) throw new Error("apiFetch n'a pas été appelé");
  return JSON.parse(String((appel[1] as RequestInit).body));
}

const INJOIGNABLE = { ok: false as const, status: 503, error: "api_unreachable" };

/** Un corps de session amputé d'un champ obligatoire du schéma. */
const SESSION_TRONQUEE = {
  access_token: "acces-123",
  access_token_expires_in: 900,
  // refresh_token et refresh_token_expires_in manquants
  user: { id: 1, email: "a@b.c" },
};

function cookiesPoses(reponse: Response): string[] {
  return reponse.headers.getSetCookie();
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("Django injoignable", () => {
  it("login → 503 générique, aucun cookie posé, aucun détail interne", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);
    const reponse = await login(
      requeteJson("http://localhost/api/auth/login", { email: "a@b.c", password: "x" }),
    );

    expect(reponse.status).toBe(503);
    expect(await reponse.json()).toEqual({ detail: "Service indisponible." });
    expect(cookiesPoses(reponse)).toEqual([]);
  });

  it("register → 503, aucun cookie posé", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);
    const reponse = await register(
      requeteJson("http://localhost/api/auth/register", { email: "a@b.c", password: "x" }),
    );

    expect(reponse.status).toBe(503);
    expect(cookiesPoses(reponse)).toEqual([]);
  });

  it("refresh → 503, et surtout : les cookies existants ne sont PAS effacés", async () => {
    // Effacer sur une panne réseau déconnecterait tout le monde à chaque hoquet de Django.
    apiFetch.mockResolvedValue(INJOIGNABLE);
    const reponse = await refresh(
      requeteJson("http://localhost/api/auth/refresh", {}, "refresh=famille.secret"),
    );

    expect(reponse.status).toBe(503);
    expect(cookiesPoses(reponse)).toEqual([]);
  });

  it("password-reset/confirm → 503 sans révéler que le jeton existait", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);
    const reponse = await resetConfirm(
      requeteJson("http://localhost/api/auth/password-reset/confirm", {
        token: "jeton",
        password: "un-mot-de-passe-long",
      }),
    );

    expect(reponse.status).toBe(503);
    expect(await reponse.json()).toEqual({ detail: "Service indisponible." });
  });

  it("/api/me → 503 générique", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);
    const reponse = await me(
      new NextRequest(new Request("http://localhost/api/me", { headers: { cookie: "session=a" } })),
    );

    expect(reponse.status).toBe(503);
    expect(await reponse.json()).toEqual({ detail: "Service indisponible." });
  });

  it("logout sans cookie de refresh → 204, cookies effacés, jeton vide envoyé à Django", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 204, data: null });
    const reponse = await logout(requeteJson("http://localhost/api/auth/logout", {}));

    expect(reponse.status).toBe(204);
    expect(corpsTransmis()).toEqual({ refresh_token: "" });
    expect(cookiesPoses(reponse).join(" ")).toContain("session=;");
  });

  it("logout-all → relaie le statut d'échec mais efface quand même les cookies", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, error: "api_error" });
    const reponse = await logoutAll(
      requeteJson("http://localhost/api/auth/logout-all", {}, "session=acces-123"),
    );

    expect(reponse.status).toBe(500);
    const cookies = cookiesPoses(reponse).join(" ");
    expect(cookies).toContain("session=;");
    expect(cookies).toContain("refresh=;");
  });
});

describe("réponse de Django hors schéma", () => {
  it("login → 502 et aucun cookie, malgré un access_token présent dans le corps", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_TRONQUEE });
    const reponse = await login(
      requeteJson("http://localhost/api/auth/login", { email: "a@b.c", password: "x" }),
    );

    expect(reponse.status).toBe(502);
    expect(await reponse.json()).toEqual({ detail: "Réponse inattendue du serveur." });
    expect(cookiesPoses(reponse)).toEqual([]);
  });

  it("refresh → 502 et aucun cookie", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_TRONQUEE });
    const reponse = await refresh(
      requeteJson("http://localhost/api/auth/refresh", {}, "refresh=famille.secret"),
    );

    expect(reponse.status).toBe(502);
    expect(cookiesPoses(reponse)).toEqual([]);
  });

  it("/api/me → 502, le profil non validé n'est pas relayé au navigateur", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 1, email: "a@b.c", is_staff: "oui" },
    });
    const reponse = await me(
      new NextRequest(new Request("http://localhost/api/me", { headers: { cookie: "session=a" } })),
    );

    expect(reponse.status).toBe(502);
    expect(await reponse.json()).toEqual({ detail: "Réponse inattendue du serveur." });
  });
});

describe("corps de requête invalide", () => {
  it("login sans mot de passe → 401 (même réponse qu'un échec), sans appeler Django", async () => {
    const reponse = await login(
      requeteJson("http://localhost/api/auth/login", { email: "a@b.c" }),
    );

    expect(reponse.status).toBe(401);
    expect(await reponse.json()).toEqual({ detail: "Email ou mot de passe incorrect." });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("login sur un corps qui n'est pas du JSON → 401, sans appeler Django", async () => {
    const reponse = await login(requeteBrute("http://localhost/api/auth/login", "pas du json"));

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("password-reset/confirm sans jeton → 400, sans appeler Django", async () => {
    const reponse = await resetConfirm(
      requeteJson("http://localhost/api/auth/password-reset/confirm", { password: "x" }),
    );

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ detail: "Requête invalide." });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("register ignore les champs non déclarés (is_staff, status) au lieu de les relayer", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 400, data: { email: ["invalide"] } });
    await register(
      requeteJson("http://localhost/api/auth/register", {
        email: "a@b.c",
        password: "un-mot-de-passe-long",
        is_staff: true,
        status: "ACTIVE",
        enrollment_status: "ACTIVE",
      }),
    );

    const corpsRelaye = corpsTransmis() as Record<string, unknown>;
    expect(corpsRelaye).toEqual({ email: "a@b.c", password: "un-mot-de-passe-long" });
    expect(corpsRelaye).not.toHaveProperty("is_staff");
    expect(corpsRelaye).not.toHaveProperty("status");
    expect(corpsRelaye).not.toHaveProperty("enrollment_status");
  });

  it("login n'accepte pas non plus de champs supplémentaires", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: {} });
    await login(
      requeteJson("http://localhost/api/auth/login", {
        email: "a@b.c",
        password: "x",
        is_staff: true,
      }),
    );

    expect(corpsTransmis()).toEqual({ email: "a@b.c", password: "x" });
  });
});

describe("limitation de débit relayée", () => {
  it("register → 429 avec un message neutre", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 429, data: { detail: "throttled" } });
    const reponse = await register(
      requeteJson("http://localhost/api/auth/register", {
        email: "a@b.c",
        password: "un-mot-de-passe-long",
      }),
    );

    expect(reponse.status).toBe(429);
    expect(await reponse.json()).toEqual({ detail: "Trop de tentatives. Réessaie plus tard." });
    expect(cookiesPoses(reponse)).toEqual([]);
  });

  it("password-reset/confirm → 429 avec un message neutre", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 429, data: { detail: "throttled" } });
    const reponse = await resetConfirm(
      requeteJson("http://localhost/api/auth/password-reset/confirm", {
        token: "jeton",
        password: "un-mot-de-passe-long",
      }),
    );

    expect(reponse.status).toBe(429);
    expect(await reponse.json()).toEqual({ detail: "Trop de tentatives. Réessaie plus tard." });
  });
});

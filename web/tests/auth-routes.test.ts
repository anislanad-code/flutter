import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: register } = await import("@/app/api/auth/register/route");
const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: refresh } = await import("@/app/api/auth/refresh/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { POST: logoutAll } = await import("@/app/api/auth/logout-all/route");
const { POST: resetRequest } = await import("@/app/api/auth/password-reset/request/route");
const { POST: resetConfirm } = await import("@/app/api/auth/password-reset/confirm/route");
const { GET: me } = await import("@/app/api/me/route");

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
    flagged_for_review: false,
    created_at: "2026-01-01T00:00:00Z",
    last_activity_at: null,
  },
};

function requeteJson(url: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(
    new Request(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: cookie ? { cookie } : undefined,
    }),
  );
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("POST /api/auth/register", () => {
  it("pose les cookies httpOnly quand le compte est bien créé", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: SESSION_OK });

    const reponse = await register(
      requeteJson("https://anis.dev/api/auth/register", {
        email: "e@example.com",
        password: "un-mot-de-passe-solide-1",
      }),
    );

    expect(reponse.status).toBe(201);
    const cookieSession = reponse.cookies.get("session");
    expect(cookieSession?.value).toBe("acces-123");
    expect(cookieSession?.httpOnly).toBe(true);
    expect(cookieSession?.sameSite).toBe("strict");
    // Le token brut ne doit jamais apparaître dans le corps JSON renvoyé au navigateur.
    const corps = JSON.stringify(await reponse.clone().json());
    expect(corps).not.toContain("acces-123");
  });

  it("renvoie la même réponse générique sans poser de cookie si l'email existait déjà", async () => {
    // Django renvoie 201 sans session (voir services.enregistrer) : le zod-parse du
    // schéma de session échoue, ce qui déclenche le message générique anti-énumération.
    apiFetch.mockResolvedValue({
      ok: true,
      status: 201,
      data: { detail: "Compte créé si l'email était disponible. Connecte-toi pour continuer." },
    });

    const reponse = await register(
      requeteJson("https://anis.dev/api/auth/register", {
        email: "e@example.com",
        password: "un-mot-de-passe-solide-1",
      }),
    );

    expect(reponse.status).toBe(201);
    expect(reponse.cookies.get("session")).toBeUndefined();
  });

  it("relaie les erreurs de mot de passe (400) sans les transformer", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 400,
      data: { password: ["Ce mot de passe est trop courant."] },
    });

    const reponse = await register(
      requeteJson("https://anis.dev/api/auth/register", { email: "e@example.com", password: "x" }),
    );

    expect(reponse.status).toBe(400);
    await expect(reponse.json()).resolves.toEqual({
      password: ["Ce mot de passe est trop courant."],
    });
  });

  it("répond 400 sur un corps qui n'est pas du JSON exploitable", async () => {
    const requete = new NextRequest(
      new Request("https://anis.dev/api/auth/register", { method: "POST", body: "{" }),
    );

    const reponse = await register(requete);

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("répond 503 quand Django est injoignable", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    const reponse = await register(
      requeteJson("https://anis.dev/api/auth/register", {
        email: "e@example.com",
        password: "un-mot-de-passe-solide-1",
      }),
    );

    expect(reponse.status).toBe(503);
  });
});

describe("POST /api/auth/login", () => {
  it("pose les cookies et ne renvoie jamais les tokens bruts au navigateur", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_OK });

    const reponse = await login(
      requeteJson("https://anis.dev/api/auth/login", {
        email: "e@example.com",
        password: "x",
      }),
    );

    expect(reponse.status).toBe(200);
    expect(reponse.cookies.get("session")?.value).toBe("acces-123");
    expect(reponse.cookies.get("refresh")?.httpOnly).toBe(true);
    const corps = JSON.stringify(await reponse.clone().json());
    expect(corps).not.toContain("acces-123");
    expect(corps).not.toContain(SESSION_OK.refresh_token);
  });

  it("renvoie le même message pour un compte inconnu ou un mauvais mot de passe (401)", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: { detail: "peu importe" } });

    const reponse = await login(
      requeteJson("https://anis.dev/api/auth/login", { email: "x@example.com", password: "y" }),
    );

    expect(reponse.status).toBe(401);
    await expect(reponse.json()).resolves.toEqual({
      detail: "Email ou mot de passe incorrect.",
    });
  });

  it("relaie le 429 de limitation de débit", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 429, data: {} });

    const reponse = await login(
      requeteJson("https://anis.dev/api/auth/login", { email: "x@example.com", password: "y" }),
    );

    expect(reponse.status).toBe(429);
  });

  it("transmet l'IP réelle du visiteur à Django via X-Forwarded-For", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_OK });

    await login(
      new NextRequest(
        new Request("https://anis.dev/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: "e@example.com", password: "x" }),
          headers: { "x-forwarded-for": "41.100.5.7" },
        }),
      ),
    );

    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Forwarded-For"]).toBe("41.100.5.7");
  });
});

describe("POST /api/auth/refresh", () => {
  it("répond 401 sans effacer de cookie inexistant quand aucun refresh n'est présent", async () => {
    const reponse = await refresh(new NextRequest(new Request("https://anis.dev/api/auth/refresh", { method: "POST" })));

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("tourne les cookies quand Django accepte le refresh", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_OK });

    const reponse = await refresh(
      new NextRequest(
        new Request("https://anis.dev/api/auth/refresh", {
          method: "POST",
          headers: { cookie: "refresh=ancien-refresh" },
        }),
      ),
    );

    expect(reponse.status).toBe(200);
    expect(reponse.cookies.get("refresh")?.value).toBe(SESSION_OK.refresh_token);
  });

  it("efface les cookies quand le refresh est invalide (401), mais pas sur un simple 429", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, status: 401, data: {} });
    const reponseInvalide = await refresh(
      new NextRequest(
        new Request("https://anis.dev/api/auth/refresh", {
          method: "POST",
          headers: { cookie: "refresh=perime" },
        }),
      ),
    );
    expect(reponseInvalide.status).toBe(401);
    expect(reponseInvalide.cookies.get("refresh")?.value).toBe("");

    apiFetch.mockResolvedValueOnce({ ok: true, status: 429, data: {} });
    const reponseLimitee = await refresh(
      new NextRequest(
        new Request("https://anis.dev/api/auth/refresh", {
          method: "POST",
          headers: { cookie: "refresh=en-cours" },
        }),
      ),
    );
    expect(reponseLimitee.status).toBe(429);
    expect(reponseLimitee.cookies.get("refresh")).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  it("efface toujours les cookies, même si Django échoue", async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: "api_unreachable" });

    const reponse = await logout(
      new NextRequest(
        new Request("https://anis.dev/api/auth/logout", {
          method: "POST",
          headers: { cookie: "refresh=abc" },
        }),
      ),
    );

    expect(reponse.status).toBe(204);
    expect(reponse.cookies.get("session")?.value).toBe("");
    expect(reponse.cookies.get("refresh")?.value).toBe("");
  });
});

describe("POST /api/auth/logout-all", () => {
  it("répond 401 sans appeler Django si aucun cookie de session n'est présent", async () => {
    const reponse = await logoutAll(
      new NextRequest(new Request("https://anis.dev/api/auth/logout-all", { method: "POST" })),
    );

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("forwarde le cookie de session à Django et efface les cookies du navigateur", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 204, data: null });

    const reponse = await logoutAll(
      new NextRequest(
        new Request("https://anis.dev/api/auth/logout-all", {
          method: "POST",
          headers: { cookie: "session=acces-123" },
        }),
      ),
    );

    expect(reponse.status).toBe(204);
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Cookie).toBe("access_token=acces-123");
    expect(reponse.cookies.get("session")?.value).toBe("");
  });
});

describe("POST /api/auth/password-reset/request", () => {
  it("renvoie toujours le même message, même si l'appel à Django échoue", async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, status: 503, error: "api_unreachable" });

    const reponse = await resetRequest(
      requeteJson("https://anis.dev/api/auth/password-reset/request", { email: "x@example.com" }),
    );

    expect(reponse.status).toBe(200);
    await expect(reponse.json()).resolves.toEqual({
      detail:
        "Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.",
    });
  });

  it("renvoie le même message sur un corps invalide, sans appeler Django", async () => {
    const requete = new NextRequest(
      new Request("https://anis.dev/api/auth/password-reset/request", {
        method: "POST",
        body: "pas du json",
      }),
    );

    const reponse = await resetRequest(requete);

    expect(reponse.status).toBe(200);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/password-reset/confirm", () => {
  it("relaie un succès en 204 sans corps", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 204, data: null });

    const reponse = await resetConfirm(
      requeteJson("https://anis.dev/api/auth/password-reset/confirm", {
        token: "t",
        password: "un-nouveau-mot-de-passe-1",
      }),
    );

    expect(reponse.status).toBe(204);
  });

  it("relaie une erreur de jeton (400) telle quelle", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 400, data: { detail: "Ce lien n'est plus valable." } });

    const reponse = await resetConfirm(
      requeteJson("https://anis.dev/api/auth/password-reset/confirm", {
        token: "invalide",
        password: "un-nouveau-mot-de-passe-1",
      }),
    );

    expect(reponse.status).toBe(400);
    await expect(reponse.json()).resolves.toEqual({ detail: "Ce lien n'est plus valable." });
  });
});

describe("GET /api/me", () => {
  it("répond 401 sans appeler Django si aucun cookie de session n'est présent", async () => {
    const reponse = await me(new NextRequest(new Request("https://anis.dev/api/me")));

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renvoie le profil quand la session est valide", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: SESSION_OK.user });

    const reponse = await me(
      new NextRequest(new Request("https://anis.dev/api/me", { headers: { cookie: "session=acces-123" } })),
    );

    expect(reponse.status).toBe(200);
    await expect(reponse.json()).resolves.toEqual(SESSION_OK.user);
  });

  it("répond 401 quand Django rejette le cookie", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: {} });

    const reponse = await me(
      new NextRequest(new Request("https://anis.dev/api/me", { headers: { cookie: "session=perime" } })),
    );

    expect(reponse.status).toBe(401);
  });
});

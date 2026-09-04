import { beforeEach, describe, expect, it, vi } from "vitest";

/* `utilisateurCourant()` est la seule porte d'entrée des Server Components de /app et
   /admin. Trois choses doivent être vraies : pas de cookie → pas d'appel réseau du tout,
   401 de Django → null (jamais d'exception qui casserait le rendu), et une réponse dont
   la forme ne correspond pas au schéma Zod → null (le front ne fait pas confiance à la
   forme des données, §7). */

const apiFetch = vi.hoisted(() => vi.fn());
const cookiesGet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookiesGet }),
}));

const { utilisateurCourant } = await import("@/lib/current-user");

const UTILISATEUR = {
  id: 7,
  email: "etudiante@example.com",
  phone: "0550000000",
  is_staff: false,
  created_at: "2026-01-01T00:00:00Z",
  last_activity_at: null,
};

beforeEach(() => {
  apiFetch.mockReset();
  cookiesGet.mockReset();
});

describe("utilisateurCourant", () => {
  it("renvoie l'utilisateur quand le cookie de session est présent et valide", async () => {
    cookiesGet.mockReturnValue({ value: "acces-123" });
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: UTILISATEUR });

    await expect(utilisateurCourant()).resolves.toEqual(UTILISATEUR);

    expect(cookiesGet).toHaveBeenCalledWith("session");
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/me",
      { headers: { Cookie: "access_token=acces-123" } },
      { acceptStatuses: [401] },
    );
  });

  it("ne contacte pas Django quand il n'y a pas de cookie", async () => {
    cookiesGet.mockReturnValue(undefined);

    await expect(utilisateurCourant()).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renvoie null sur un 401 (session expirée ou révoquée)", async () => {
    cookiesGet.mockReturnValue({ value: "acces-perime" });
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: { detail: "..." } });

    await expect(utilisateurCourant()).resolves.toBeNull();
  });

  it("renvoie null quand l'API est injoignable", async () => {
    cookiesGet.mockReturnValue({ value: "acces-123" });
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    await expect(utilisateurCourant()).resolves.toBeNull();
  });

  it("renvoie null quand la réponse ne respecte pas le schéma (is_staff manquant)", async () => {
    cookiesGet.mockReturnValue({ value: "acces-123" });
    const tronque: Record<string, unknown> = { ...UTILISATEUR };
    delete tronque.is_staff;
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: tronque });

    await expect(utilisateurCourant()).resolves.toBeNull();
  });

  it("refuse un is_staff arrivant en chaîne de caractères (pas de coercition Zod)", async () => {
    cookiesGet.mockReturnValue({ value: "acces-123" });
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...UTILISATEUR, is_staff: "true" },
    });

    await expect(utilisateurCourant()).resolves.toBeNull();
  });

  it("renvoie null sur un corps vide", async () => {
    cookiesGet.mockReturnValue({ value: "acces-123" });
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: null });

    await expect(utilisateurCourant()).resolves.toBeNull();
  });

  it("accepte un cookie vide comme une absence de session", async () => {
    cookiesGet.mockReturnValue({ value: "" });

    await expect(utilisateurCourant()).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

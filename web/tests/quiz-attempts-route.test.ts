import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* Le BFF de démarrage de tentative (§6). Aucune logique métier ici (§7) — il relaie le
   cookie de session et traduit les statuts de Django. */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: demarrer, GET: demarrerGet } = await import(
  "@/app/api/quizzes/[id]/attempts/route"
);

const SESSION = "session=jeton-de-session";

function requete(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("BFF démarrage de tentative", () => {
  it("relaye le cookie de session et renvoie la tentative créée", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: 42, started_at: "2026-01-01T00:00:00Z" },
    });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(201);
    expect(await reponse.json()).toEqual({ id: 42, started_at: "2026-01-01T00:00:00Z" });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/quizzes/1/attempts",
      expect.objectContaining({ method: "POST" }),
      { acceptStatuses: [401, 404, 409, 429] },
    );
  });

  it("sans session : 401 sans appeler Django", async () => {
    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un quiz refusé par Django (paywall, IDOR) redevient 404", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(404);
  });

  it("quota de tentatives épuisé : 409 relayé", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 409,
      data: { detail: "Tu as utilisé toutes tes tentatives pour ce QCM." },
    });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(409);
  });

  it("relaye le 429 de Django", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 429, data: { detail: "Trop." } });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(429);
  });

  it("Django injoignable : 503, jamais l'URL interne", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(503);
    expect(JSON.stringify(await reponse.json())).not.toContain("api_unreachable");
  });

  it("un corps hors schéma renvoie 502, pas de réponse partielle", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { fuite: true } });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(502);
  });

  it("GET n'existe pas sur cette route", async () => {
    const reponse = await demarrerGet();
    expect(reponse.status).toBe(404);
  });
});

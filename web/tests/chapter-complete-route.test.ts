import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* Le BFF de complétion de chapitre (§5). Il ne fait que relayer le cookie de session
   et le résultat — aucune logique de progression ici (§7). */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: complete, GET: completeGet } =
  await import("@/app/api/chapters/[slug]/complete/route");

const SESSION = "session=jeton-de-session";

function requete(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("BFF complétion de chapitre", () => {
  it("relaye le cookie de session vers Django", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { chapter_slug: "installer-flutter", state: "termine" },
    });

    const reponse = await complete(
      requete("http://localhost/api/chapters/installer-flutter/complete", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ slug: "installer-flutter" }) },
    );

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({
      chapter_slug: "installer-flutter",
      state: "termine",
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chapters/installer-flutter/complete",
      expect.objectContaining({ method: "POST" }),
      { acceptStatuses: [401, 404, 429] },
    );
  });

  it("sans session : 401 sans appeler Django", async () => {
    const reponse = await complete(
      requete("http://localhost/api/chapters/installer-flutter/complete", {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "installer-flutter" }) },
    );

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un chapitre refusé par Django (paywall, IDOR) redevient 404", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 404,
      data: { detail: "Not found." },
    });

    const reponse = await complete(
      requete("http://localhost/api/chapters/premier-widget/complete", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ slug: "premier-widget" }) },
    );

    expect(reponse.status).toBe(404);
  });

  it("relaye le 429 de Django", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 429,
      data: { detail: "Trop." },
    });

    const reponse = await complete(
      requete("http://localhost/api/chapters/installer-flutter/complete", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ slug: "installer-flutter" }) },
    );

    expect(reponse.status).toBe(429);
  });

  it("un cookie expiré (401 de Django) redevient un 401 explicite", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 401,
      data: { detail: "Non authentifié." },
    });

    const reponse = await complete(
      requete("http://localhost/api/chapters/installer-flutter/complete", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ slug: "installer-flutter" }) },
    );

    expect(reponse.status).toBe(401);
  });

  it("Django injoignable : 503, jamais l'URL interne", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 503,
      error: "api_unreachable",
    });

    const reponse = await complete(
      requete("http://localhost/api/chapters/installer-flutter/complete", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ slug: "installer-flutter" }) },
    );

    expect(reponse.status).toBe(503);
    expect(JSON.stringify(await reponse.json())).not.toContain(
      "api_unreachable",
    );
  });

  it("un corps hors schéma renvoie 502, pas de réponse partielle", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { fuite: true },
    });

    const reponse = await complete(
      requete("http://localhost/api/chapters/installer-flutter/complete", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ slug: "installer-flutter" }) },
    );

    expect(reponse.status).toBe(502);
  });

  it("GET n'existe pas sur cette route", async () => {
    const reponse = await completeGet();
    expect(reponse.status).toBe(404);
  });
});

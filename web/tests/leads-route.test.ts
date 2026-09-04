import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: leads } = await import("@/app/api/public/leads/route");

function requeteJson(body: unknown): NextRequest {
  return new NextRequest(
    new Request("https://anis.dev/api/public/leads", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-forwarded-for": "41.226.1.2" },
    }),
  );
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("POST /api/public/leads", () => {
  it("relaie l'IP du visiteur à Django et renvoie 201", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { detail: "ok" } });

    const reponse = await leads(
      requeteJson({ email: "a@example.com", phone: "", site: "", form_rendered_at: 1 }),
    );

    expect(reponse.status).toBe(201);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/public/leads",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Forwarded-For": "41.226.1.2" },
      }),
      { acceptStatuses: [400, 429] },
    );
  });

  it("renvoie 400 sans appeler Django quand le corps est invalide", async () => {
    const reponse = await leads(requeteJson({ phone: "0555" }));

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("relaie le 429 de la limite de débit", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 429, data: { detail: "Trop." } });

    const reponse = await leads(
      requeteJson({ email: "a@example.com", form_rendered_at: 1 }),
    );

    expect(reponse.status).toBe(429);
  });

  it("renvoie 503 quand Django est injoignable, sans détail interne", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    const reponse = await leads(
      requeteJson({ email: "a@example.com", form_rendered_at: 1 }),
    );

    expect(reponse.status).toBe(503);
    const corps = await reponse.json();
    expect(JSON.stringify(corps)).not.toContain("api_unreachable");
  });

  it("répond la même chose qu'une soumission suspecte soit acceptée en silence ou non par Django", async () => {
    // Le BFF ne sait pas distinguer une vraie inscription d'une soumission suspecte
    // filtrée côté Django (§ services.creer_lead) : les deux reçoivent un 201 de Django,
    // donc le BFF les traite identiquement — c'est le point du honeypot / délai minimum.
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { detail: "ok" } });

    const reponse = await leads(
      requeteJson({ email: "bot@example.com", site: "http://spam.example", form_rendered_at: 1 }),
    );

    expect(reponse.status).toBe(201);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { GET } = await import("@/app/api/health/route");

describe("GET /api/health", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("relaie l'état de Django quand tout répond", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { status: "ok", db: "ok" } });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", api: "ok", db: "ok" });
  });

  it("répond 503 quand Django est injoignable", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "down", api: "unreachable" });
  });

  it("répond 502 si Django renvoie une forme inattendue", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { statut: "peut-être" } });

    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      status: "down",
      api: "invalid_response",
    });
  });

  it("ne divulgue jamais l'URL interne de Django dans la réponse", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "http://api:8000 refused" });

    const corps = JSON.stringify(await (await GET()).json());

    expect(corps).not.toContain("api:8000");
  });
});

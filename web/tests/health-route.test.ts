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

  it("distingue une base tombée d'une API injoignable", async () => {
    /* Django répond 503 avec un corps exploitable quand sa base est morte. Sans
       `acceptStatuses`, le BFF concluait « unreachable » : diagnostic faux dans le
       seul cas de panne que la sonde existe pour détecter. */
    apiFetch.mockResolvedValue({ ok: true, status: 503, data: { status: "degraded", db: "down" } });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "down",
      api: "ok",
      db: "down",
    });
  });

  it("demande explicitement à relayer le 503 de la sonde, et rien d'autre", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { status: "ok", db: "ok" } });

    await GET();

    expect(apiFetch).toHaveBeenCalledWith("/api/health", {}, { acceptStatuses: [503] });
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

  it("ne recopie que les champs qu'il connaît, quoi que Django ajoute", async () => {
    /* L'ancienne version de ce test mockait un échec, cas où la route renvoie un
       littéral figé : elle ne pouvait pas échouer. Ici on fait passer des champs
       internes par le chemin nominal et on vérifie qu'aucun ne ressort. */
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        status: "ok",
        db: "ok",
        dsn: "postgresql://anisdev:motdepasse@db:5432/anisdev",
        internal_url: "http://api:8000",
        django_version: "5.2.17",
      },
    });

    const response = await GET();
    const corps = JSON.stringify(await response.json());

    expect(JSON.parse(corps)).toEqual({ status: "ok", api: "ok", db: "ok" });
    expect(corps).not.toContain("api:8000");
    expect(corps).not.toContain("postgresql");
    expect(corps).not.toContain("5.2.17");
  });
});

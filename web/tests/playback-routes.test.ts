import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: playback, GET: playbackGet } = await import("@/app/api/lessons/[id]/playback/route");
const { POST: heartbeat, GET: heartbeatGet } = await import("@/app/api/playback/[id]/heartbeat/route");

const LECTURE = {
  disponible: true,
  playback_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  playback_url:
    "https://vz-test.b-cdn.net/bcdn_token=HS256-abc&token_path=%2Fx%2F&expires=1/x/playlist.m3u8",
  expires_at: "2026-09-04T17:00:00Z",
  watermark_label: "etudiante · 2233",
  resume_at_s: 12,
  duration_s: 480,
};

const BATTEMENT = {
  active: true,
  expires_at: "2026-09-04T17:00:00Z",
  resume_at_s: 12,
};

function requete(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("BFF playback", () => {
  it("relaye un jeton sans exiger de session (chapitre gratuit)", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: LECTURE });

    const reponse = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });

    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.playback_id).toBe(LECTURE.playback_id);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/lessons/7/playback",
      expect.objectContaining({ method: "POST" }),
      { acceptStatuses: [401, 404, 429, 503] },
    );
  });

  it("n'appelle pas Django pour un id non numérique", async () => {
    const reponse = await playback(
      requete("http://localhost/api/lessons/abc/playback", { method: "POST" }),
      { params: Promise.resolve({ id: "abc" }) },
    );
    expect(reponse.status).toBe(404);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("pose le cookie device s'il est absent", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: LECTURE });
    const reponse = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(reponse.cookies.get("device")?.value).toBeTruthy();
  });

  it("transmet l'empreinte et l'IP, jamais un droit du client", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: LECTURE });
    const brute = new Request("http://localhost/api/lessons/7/playback", {
      method: "POST",
      headers: { cookie: "device=empreinte-xyz", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ is_staff: true, role: "admin" }),
    });
    await playback(new NextRequest(brute), { params: Promise.resolve({ id: "7" }) });

    const init = apiFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Device-Fingerprint"]).toBe("empreinte-xyz");
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(init.body).toBe("{}");
  });

  it("refuse une réponse Django hors schéma", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { disponible: true } });
    const reponse = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(reponse.status).toBe(502);
  });

  it("refuse une URL de lecture qui n'est pas https", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...LECTURE, playback_url: "javascript:alert(1)" },
    });
    const reponse = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(reponse.status).toBe(502);
  });

  it("relaye le 429 sans bavardage", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 429, data: { detail: "Trop." } });
    const reponse = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(reponse.status).toBe(429);
    expect(await reponse.json()).toEqual({ detail: "Trop de tentatives. Réessaie plus tard." });
  });

  it("relaye le 503 Bunny en message générique", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 503, data: { detail: "Vidéo indisponible." } });
    const reponse = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(reponse.status).toBe(503);
    expect(await reponse.json()).toEqual({ detail: "Vidéo indisponible." });
  });

  it("distingue un 401 de session d'un 404 leçon", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: { detail: "auth" } });
    const nonAuth = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Non trouvé." } });
    const absent = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(nonAuth.status).toBe(401);
    expect(await nonAuth.json()).toEqual({ detail: "Session invalide ou expirée." });
    expect(absent.status).toBe(404);
    expect(await absent.json()).toEqual({ detail: "Non trouvé." });
  });

  it("répond 404 au GET, sans appeler Django", async () => {
    const reponse = await playbackGet();
    expect(reponse.status).toBe(404);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("répond 503 si Django est injoignable", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });
    const reponse = await playback(requete("http://localhost/api/lessons/7/playback", { method: "POST" }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(reponse.status).toBe(503);
  });

  it("ne réécrit pas le cookie device s'il est déjà posé", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: LECTURE });
    const brute = new Request("http://localhost/api/lessons/7/playback", {
      method: "POST",
      headers: { cookie: "device=deja-la" },
    });
    const reponse = await playback(new NextRequest(brute), { params: Promise.resolve({ id: "7" }) });
    expect(reponse.cookies.get("device")).toBeUndefined();
  });
});

describe("BFF heartbeat", () => {
  const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  it("ne relaie que watched_s", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: BATTEMENT });
    const brute = new Request(`http://localhost/api/playback/${ID}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ watched_s: 44, is_staff: true, playback_url: "http://evil" }),
    });
    const reponse = await heartbeat(new NextRequest(brute), { params: Promise.resolve({ id: ID }) });
    expect(reponse.status).toBe(200);
    const init = apiFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ watched_s: 44 }));
  });

  it("404 sur un id qui n'est pas un UUID, sans appeler Django", async () => {
    const reponse = await heartbeat(
      requete("http://localhost/api/playback/pas-un-uuid/heartbeat", { method: "POST" }),
      { params: Promise.resolve({ id: "pas-un-uuid" }) },
    );
    expect(reponse.status).toBe(404);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("envoie un corps vide si watched_s est absent ou illisible", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: BATTEMENT });
    await heartbeat(
      requete(`http://localhost/api/playback/${ID}/heartbeat`, {
        method: "POST",
        body: "pas-du-json",
      }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(apiFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ body: "{}" }));

    apiFetch.mockClear();
    const brute = new Request(`http://localhost/api/playback/${ID}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ watched_s: "12", is_staff: true }),
    });
    await heartbeat(new NextRequest(brute), { params: Promise.resolve({ id: ID }) });
    expect(apiFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ body: "{}" }));
  });

  it("transforme un 404 Django en 404 identique", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Non trouvé." } });
    const reponse = await heartbeat(
      requete(`http://localhost/api/playback/${ID}/heartbeat`, { method: "POST" }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(reponse.status).toBe(404);
    expect(await reponse.json()).toEqual({ detail: "Non trouvé." });
  });

  it("répond 503 si Django est injoignable", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });
    const reponse = await heartbeat(
      requete(`http://localhost/api/playback/${ID}/heartbeat`, { method: "POST" }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(reponse.status).toBe(503);
  });

  it("refuse une réponse Django hors schéma", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { active: true } });
    const reponse = await heartbeat(
      requete(`http://localhost/api/playback/${ID}/heartbeat`, { method: "POST" }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(reponse.status).toBe(502);
  });

  it("répond 404 au GET heartbeat, sans appeler Django", async () => {
    const reponse = await heartbeatGet();
    expect(reponse.status).toBe(404);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

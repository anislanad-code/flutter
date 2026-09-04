import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* Le BFF de soumission (§6). Il ne valide que la *forme* du corps avant de le relayer
   (§7) — la correction elle-même reste entièrement du côté de Django (§4.4). */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: soumettre, GET: soumettreGet } = await import(
  "@/app/api/attempts/[id]/submit/route"
);

const SESSION = "session=jeton-de-session";
const RESULTAT = {
  attempt_id: 1,
  score: 100,
  passed: true,
  pass_threshold: 60,
  attempts_remaining: 2,
  questions: [
    {
      id: 10,
      text: "Une question ?",
      explanation: "Voici pourquoi.",
      choices: [
        { id: 100, text: "Réponse A", is_correct: true, chosen: true },
        { id: 101, text: "Réponse B", is_correct: false, chosen: false },
      ],
    },
  ],
};

function requete(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

function corpsJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { cookie: SESSION, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("BFF soumission de tentative", () => {
  it("relaye le cookie de session et le résultat corrigé", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: RESULTAT });

    const reponse = await soumettre(
      requete(
        "http://localhost/api/attempts/1/submit",
        corpsJson({ answers: { "10": 100 } }),
      ),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual(RESULTAT);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/attempts/1/submit",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ answers: { "10": 100 } }) }),
      { acceptStatuses: [400, 401, 404, 409, 429] },
    );
  });

  it("sans session : 401 sans appeler Django", async () => {
    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", {
        method: "POST",
        body: JSON.stringify({ answers: {} }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un corps qui n'a pas la forme attendue est refusé avant Django", async () => {
    const reponse = await soumettre(
      requete(
        "http://localhost/api/attempts/1/submit",
        corpsJson({ answers: { "10": "pas-un-nombre" } }),
      ),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("une tentative d'un autre étudiant (IDOR) redevient 404", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(404);
  });

  it("soumission trop rapide (anti-triche) : 400 relayé avec le message de Django", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 400,
      data: { detail: "Réponds un peu plus lentement avant d'envoyer." },
    });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      detail: "Réponds un peu plus lentement avant d'envoyer.",
    });
  });

  it("double soumission : 409 relayé", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 409,
      data: { detail: "Cette tentative a déjà été corrigée." },
    });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(409);
  });

  it("relaye le 429 de Django", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 429, data: { detail: "Trop." } });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(429);
  });

  it("Django injoignable : 503, jamais l'URL interne", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(503);
    expect(JSON.stringify(await reponse.json())).not.toContain("api_unreachable");
  });

  it("un corps hors schéma renvoie 502, pas de réponse partielle", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { fuite: true } });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(502);
  });

  it("GET n'existe pas sur cette route", async () => {
    const reponse = await soumettreGet();
    expect(reponse.status).toBe(404);
  });
});

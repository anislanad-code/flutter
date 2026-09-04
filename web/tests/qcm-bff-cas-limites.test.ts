import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* Compléments aux tests des deux routes BFF de l'étape 6 : les branches que
   `quiz-attempts-route` et `attempt-submit-route` laissaient non exercées (401 renvoyé
   par Django alors que le cookie était présent, statut inattendu, corps de 400/409 sans
   `detail`), et les invariantes de relais : jamais l'URL interne, jamais un corps
   d'erreur de Django recopié tel quel sur les statuts qui n'ont pas de message à
   afficher. */

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: demarrer } = await import("@/app/api/quizzes/[id]/attempts/route");
const { POST: soumettre } = await import("@/app/api/attempts/[id]/submit/route");

const SESSION = "session=jeton-de-session";

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

describe("BFF démarrage — branches restantes", () => {
  it("un 401 de Django (session expirée entre-temps) est relayé tel quel", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 401,
      data: { detail: "Informations d'authentification non valides." },
    });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(401);
    // Le message de Django n'est pas recopié : la réponse est celle du BFF (§6).
    expect(await reponse.json()).toEqual({ detail: "Session invalide ou expirée." });
  });

  it("un statut inattendu (2xx autre que 201) redevient un 404 neutre", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 204, data: null });

    const reponse = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(404);
  });

  it("l'identifiant de quiz est encodé avant d'être concaténé à l'URL", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: 1, started_at: "2026-01-01T00:00:00Z" },
    });

    await demarrer(
      requete("http://localhost/api/quizzes/x/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1/../../me" }) },
    );

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/quizzes/1%2F..%2F..%2Fme/attempts",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("BFF soumission — branches restantes", () => {
  it("un 401 de Django est relayé sans recopier son corps", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 401,
      data: { detail: "Informations d'authentification non valides." },
    });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(401);
    expect(await reponse.json()).toEqual({ detail: "Session invalide ou expirée." });
  });

  it("un statut inattendu redevient un 404 neutre", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 202, data: { detail: "?" } });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(404);
    expect(await reponse.json()).toEqual({ detail: "Non trouvé." });
  });

  it("un 400 sans `detail` retombe sur le message d'anti-triche du produit", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 400, data: { answers: ["requis"] } });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({
      detail: "Réponds un peu plus lentement avant d'envoyer.",
    });
  });

  it("un 409 sans `detail` retombe sur le message de double soumission", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 409, data: null });

    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(409);
    expect(await reponse.json()).toEqual({
      detail: "Cette tentative a déjà été corrigée.",
    });
  });

  it("un corps illisible (pas du JSON) est refusé avant Django", async () => {
    const reponse = await soumettre(
      requete("http://localhost/api/attempts/1/submit", {
        method: "POST",
        headers: { cookie: SESSION, "content-type": "application/json" },
        body: "ceci n'est pas du JSON",
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un champ en trop dans le corps n'est pas relayé à Django", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: null });

    await soumettre(
      requete(
        "http://localhost/api/attempts/1/submit",
        corpsJson({ answers: { "10": 100 }, score: 100, is_staff: true }),
      ),
      { params: Promise.resolve({ id: "1" }) },
    );

    const corpsRelaye = String(
      (apiFetch.mock.calls[0]![1] as RequestInit).body,
    );
    expect(JSON.parse(corpsRelaye)).toEqual({ answers: { "10": 100 } });
    expect(corpsRelaye).not.toContain("is_staff");
    expect(corpsRelaye).not.toContain("score");
  });

  it("les deux routes n'exposent jamais l'URL interne de Django dans une erreur", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 503,
      error: "http://api:8000/api/attempts/1/submit",
    });

    const soumission = await soumettre(
      requete("http://localhost/api/attempts/1/submit", corpsJson({ answers: {} })),
      { params: Promise.resolve({ id: "1" }) },
    );
    const demarrage = await demarrer(
      requete("http://localhost/api/quizzes/1/attempts", {
        method: "POST",
        headers: { cookie: SESSION },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    for (const reponse of [soumission, demarrage]) {
      expect(reponse.status).toBe(503);
      expect(JSON.stringify(await reponse.json())).not.toContain("api:8000");
    }
  });
});

/* Cas limites du Route Handler `/api/public/leads` : ce que le BFF refuse avant
   d'appeler Django, ce qu'il relaie, et ce qu'il ne laisse jamais passer. Le chemin
   nominal, le 429 et le 503 sont couverts par `leads-route.test.ts`. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { POST: leads } = await import("@/app/api/public/leads/route");

function requete(body: string, entetes: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    new Request("https://anis.dev/api/public/leads", {
      method: "POST",
      body,
      headers: { "x-forwarded-for": "41.226.1.2", ...entetes },
    }),
  );
}

function requeteJson(body: unknown, entetes?: Record<string, string>): NextRequest {
  return requete(JSON.stringify(body), entetes);
}

const VALIDE = { email: "a@example.com", phone: "0555", site: "", form_rendered_at: 1 };

beforeEach(() => {
  apiFetch.mockReset();
});

describe("POST /api/public/leads — cas limites", () => {
  it("relaie le refus de Django en message actionnable, sans son corps brut", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 400,
      data: { email: ["Saisissez une adresse e-mail valide."], detail: "colonne catalog_lead" },
    });

    const reponse = await leads(requeteJson(VALIDE));

    expect(reponse.status).toBe(400);
    const corps = await reponse.json();
    expect(corps).toEqual({ detail: "Adresse email invalide." });
    expect(JSON.stringify(corps)).not.toContain("catalog_lead");
  });

  it("refuse un corps qui n'est pas du JSON, sans appeler Django", async () => {
    const reponse = await leads(requete("ceci n'est pas du json"));

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuse un corps vide", async () => {
    const reponse = await leads(requete(""));

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuse un horodatage de rendu envoyé en chaîne de caractères", async () => {
    const reponse = await leads(requeteJson({ ...VALIDE, form_rendered_at: "1" }));

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuse un tableau ou une valeur nulle à la place de l'objet attendu", async () => {
    for (const corps of [[], null, "chaine", 42]) {
      apiFetch.mockClear();
      const reponse = await leads(requeteJson(corps));
      expect(reponse.status).toBe(400);
      expect(apiFetch).not.toHaveBeenCalled();
    }
  });

  it("ne relaie jamais un champ non déclaré (§8.3, escalade de privilèges)", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { detail: "ok" } });

    await leads(
      requeteJson({ ...VALIDE, is_staff: true, role: "admin", status: "ACTIVE", id: 1 }),
    );

    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    const corpsRelaye = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(corpsRelaye).sort()).toEqual([
      "email",
      "form_rendered_at",
      "phone",
      "site",
    ]);
  });

  it("complète les champs facultatifs absents plutôt que d'échouer", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { detail: "ok" } });

    const reponse = await leads(
      requeteJson({ email: "a@example.com", form_rendered_at: 1 }),
    );

    expect(reponse.status).toBe(201);
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    const corpsRelaye = JSON.parse(String(init.body));
    expect(corpsRelaye.phone).toBe("");
    expect(corpsRelaye.site).toBe("");
  });

  it("relaie une chaîne d'IP en ne gardant que l'IP d'origine", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { detail: "ok" } });

    await leads(requeteJson(VALIDE, { "x-forwarded-for": "41.226.1.2, 10.0.0.1, 10.0.0.2" }));

    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Forwarded-For"]).toBe("41.226.1.2");
  });

  it("retombe sur x-real-ip, puis sur une IP vide, quand la chaîne d'en-têtes manque", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { detail: "ok" } });

    const sansXff = new NextRequest(
      new Request("https://anis.dev/api/public/leads", {
        method: "POST",
        body: JSON.stringify(VALIDE),
        headers: { "x-real-ip": "41.226.9.9" },
      }),
    );
    await leads(sansXff);
    const [, avecReal] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect((avecReal.headers as Record<string, string>)["X-Forwarded-For"]).toBe("41.226.9.9");

    apiFetch.mockClear();
    const sansRien = new NextRequest(
      new Request("https://anis.dev/api/public/leads", {
        method: "POST",
        body: JSON.stringify(VALIDE),
      }),
    );
    await leads(sansRien);
    const [, sansIp] = apiFetch.mock.calls[0] as [string, RequestInit];
    // Django retombera alors sur REMOTE_ADDR : le quota reste appliqué, jamais contourné.
    expect((sansIp.headers as Record<string, string>)["X-Forwarded-For"]).toBe("");
  });

  it("ne pose aucun cookie et ne renvoie aucune donnée du visiteur", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { detail: "ok", id: 12 } });

    const reponse = await leads(requeteJson(VALIDE));

    expect(reponse.headers.get("set-cookie")).toBeNull();
    expect(await reponse.json()).toEqual({ detail: "Inscrit à la liste d'attente." });
  });
});

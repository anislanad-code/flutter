import { beforeEach, describe, expect, it, vi } from "vitest";

/* Lectures serveur de l'inscription, et le chapitre authentifié.

   Le point non négociable : ces fonctions renvoient `null` dès que la réponse ne
   correspond pas au schéma ou que le statut n'est pas 200. Elles ne reconstruisent
   jamais un contenu à partir d'un corps partiel — c'est ce qui garantit qu'un chapitre
   payant refusé par Django (404) ne réapparaît pas côté rendu (§4.4, §7). */

const apiFetch = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("next/headers", () => ({ cookies }));

const { recupererEtatInscription, recupererInscriptionsAdmin } = await import("@/lib/enrollment");
const { recupererChapitreAuthentifie } = await import("@/lib/catalog");

const ETAT = {
  status: "PENDING",
  course_slug: "flutter-firebase-debutants",
  depot_possible: true,
  instructions: {
    provider: "MANUAL_CCP",
    requiert_preuve: true,
    amount_dzd: 12000,
    account_label: "CCP",
    account_number: "0012345678",
    account_key: "42",
    account_holder: "LANAD ANIS",
    reference: "ANISDEV-000001",
  },
  derniere_preuve: null,
};

const INSCRIPTION = {
  id: 1,
  status: "PENDING",
  user_email: "etudiante@example.com",
  user_phone: "0550112233",
  course_title: "Flutter + Firebase",
  reference: "ANISDEV-000001",
  note_admin: "",
  created_at: "2026-01-01T00:00:00Z",
  activated_at: null,
  preuves: [],
};

const CHAPITRE_PAYANT = {
  id: 2,
  slug: "premier-widget",
  title: "Ton premier widget",
  is_free: false,
  lesson: { video_provider_id: "", duration_s: 600, transcript: "Contenu.", resources: [] },
  module_title: "Mise en route",
  course_slug: "flutter-firebase-debutants",
  course_title: "Flutter + Firebase",
};

function avecSession(valeur: string | null): void {
  cookies.mockResolvedValue({
    get: (nom: string) => (valeur && nom === "session" ? { value: valeur } : undefined),
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  cookies.mockReset();
  avecSession("jeton-de-session");
});

describe("recupererEtatInscription", () => {
  it("renvoie l'état quand la réponse est valide", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: ETAT });

    await expect(recupererEtatInscription()).resolves.toEqual(ETAT);
  });

  it("sans cookie de session : null sans appeler Django", async () => {
    avecSession(null);

    await expect(recupererEtatInscription()).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rattache le cookie sous le nom attendu par Django", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: ETAT });

    await recupererEtatInscription();

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/enrollment/status",
      { headers: { Cookie: "access_token=jeton-de-session" } },
      { acceptStatuses: [401, 404] },
    );
  });

  it("un 401 ou un corps hors schéma donne null", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: {} });
    await expect(recupererEtatInscription()).resolves.toBeNull();

    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { status: "INCONNU" } });
    await expect(recupererEtatInscription()).resolves.toBeNull();
  });

  it("Django injoignable : null, jamais une exception qui casse la page", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    await expect(recupererEtatInscription()).resolves.toBeNull();
  });
});

describe("recupererInscriptionsAdmin", () => {
  it("renvoie la file validée", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: [INSCRIPTION] });

    await expect(recupererInscriptionsAdmin()).resolves.toEqual([INSCRIPTION]);
    expect(apiFetch.mock.calls[0]?.[0]).toBe("/api/admin/enrollments");
  });

  it("encode le filtre de statut dans la requête", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: [] });

    await recupererInscriptionsAdmin("ACTIVE");

    expect(apiFetch.mock.calls[0]?.[0]).toBe("/api/admin/enrollments?status=ACTIVE");
  });

  it("un 404 (compte non-admin) donne null, pas une liste vide trompeuse", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    await expect(recupererInscriptionsAdmin()).resolves.toBeNull();
  });

  it("un 400 ou un corps hors schéma donne null", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 400, data: { detail: "Statut inconnu." } });
    await expect(recupererInscriptionsAdmin("ACTIVE")).resolves.toBeNull();

    apiFetch.mockResolvedValue({ ok: true, status: 200, data: [{ id: "x" }] });
    await expect(recupererInscriptionsAdmin()).resolves.toBeNull();
  });

  it("sans session : null sans appeler Django", async () => {
    avecSession(null);

    await expect(recupererInscriptionsAdmin()).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("recupererChapitreAuthentifie", () => {
  it("renvoie le chapitre servi par Django, gratuit ou payant", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: CHAPITRE_PAYANT });

    await expect(recupererChapitreAuthentifie("premier-widget")).resolves.toEqual(CHAPITRE_PAYANT);
  });

  it("un 404 de Django reste un null : rien n'est reconstruit côté rendu", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    await expect(recupererChapitreAuthentifie("premier-widget")).resolves.toBeNull();
  });

  it("le slug est encodé avant d'entrer dans l'URL", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: null });

    await recupererChapitreAuthentifie("../../api/me");

    expect(apiFetch.mock.calls[0]?.[0]).toBe("/api/chapters/..%2F..%2Fapi%2Fme");
  });

  it("n'est jamais mis en cache : la réponse dépend du compte", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: CHAPITRE_PAYANT });

    await recupererChapitreAuthentifie("premier-widget");

    expect(apiFetch.mock.calls[0]?.[2]).toEqual({ acceptStatuses: [401, 404] });
  });

  it("sans session : null sans appeler Django", async () => {
    avecSession(null);

    await expect(recupererChapitreAuthentifie("premier-widget")).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un corps hors schéma donne null, jamais un chapitre partiel", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { title: "fuite" } });

    await expect(recupererChapitreAuthentifie("premier-widget")).resolves.toBeNull();
  });
});

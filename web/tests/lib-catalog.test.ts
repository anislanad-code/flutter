import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

const { recupererCours, recupererChapitreGratuit } = await import("@/lib/catalog");

const COURS = {
  slug: "flutter-firebase-debutants",
  title: "Flutter + Firebase",
  description: "Une vraie application.",
  modules: [],
};

const CHAPITRE = {
  id: 1,
  slug: "installer-flutter",
  title: "Installer Flutter",
  is_free: true,
  lesson: { id: 1, duration_s: 10, transcript: "Texte.", resources: [] },
  module_title: "Mise en route",
  course_slug: "flutter-firebase-debutants",
  course_title: "Flutter + Firebase",
};

beforeEach(() => {
  apiFetch.mockReset();
});

describe("recupererCours", () => {
  it("renvoie le cours quand la réponse est valide", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: COURS });

    await expect(recupererCours("flutter-firebase-debutants")).resolves.toEqual(COURS);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/public/course/flutter-firebase-debutants",
      {},
      { acceptStatuses: [404], revalidateSeconds: 300 },
    );
  });

  it("renvoie null sur 404", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Non trouvé." } });

    await expect(recupererCours("inexistant")).resolves.toBeNull();
  });

  it("renvoie null quand Django est injoignable", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    await expect(recupererCours("x")).resolves.toBeNull();
  });

  it("renvoie null quand la réponse ne respecte pas le schéma (§7 : pas de confiance aveugle)", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { slug: 42 } });

    await expect(recupererCours("x")).resolves.toBeNull();
  });
});

describe("recupererChapitreGratuit", () => {
  it("renvoie le chapitre quand la réponse est valide", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: CHAPITRE });

    await expect(recupererChapitreGratuit("installer-flutter")).resolves.toEqual(CHAPITRE);
  });

  it("renvoie null sur 404 (chapitre payant ou inexistant)", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Non trouvé." } });

    await expect(recupererChapitreGratuit("payant")).resolves.toBeNull();
  });

  it("renvoie null si is_free est faux malgré tout (défense en profondeur)", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { ...CHAPITRE, is_free: false } });

    await expect(recupererChapitreGratuit("x")).resolves.toBeNull();
  });
});

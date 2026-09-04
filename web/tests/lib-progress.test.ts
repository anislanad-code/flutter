import { beforeEach, describe, expect, it, vi } from "vitest";

/* Lecture serveur du pipeline (§5). Même garantie que `recupererChapitreAuthentifie` :
   un corps hors schéma ou un statut non-200 redevient `null`, rien n'est reconstruit. */

const apiFetch = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("next/headers", () => ({ cookies }));

const { recupererPipeline } = await import("@/lib/progress");

const PIPELINE = {
  course_slug: "flutter-firebase-debutants",
  resume_chapter_slug: "installer-flutter",
  modules: [
    {
      id: 1,
      order: 0,
      title: "Mise en route",
      unlocked: true,
      completed_chapters: 0,
      total_chapters: 2,
      chapters: [
        {
          id: 1,
          slug: "installer-flutter",
          order: 1,
          title: "Installer Flutter",
          is_free: true,
          state: "disponible",
        },
      ],
    },
  ],
};

function avecSession(valeur: string | null): void {
  cookies.mockResolvedValue({
    get: (nom: string) =>
      valeur && nom === "session" ? { value: valeur } : undefined,
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  cookies.mockReset();
  avecSession("jeton-de-session");
});

describe("recupererPipeline", () => {
  it("renvoie le pipeline quand la réponse est valide", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: PIPELINE });

    await expect(
      recupererPipeline("flutter-firebase-debutants"),
    ).resolves.toEqual(PIPELINE);
    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      "/api/progress?course=flutter-firebase-debutants",
    );
  });

  it("n'est jamais mis en cache : la réponse dépend du compte", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: PIPELINE });

    await recupererPipeline("flutter-firebase-debutants");

    expect(apiFetch.mock.calls[0]?.[2]).toEqual({ acceptStatuses: [401, 404] });
  });

  it("sans session : null sans appeler Django", async () => {
    avecSession(null);

    await expect(
      recupererPipeline("flutter-firebase-debutants"),
    ).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un 404 de Django reste un null", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 404,
      data: { detail: "Not found." },
    });

    await expect(recupererPipeline("cours-inexistant")).resolves.toBeNull();
  });

  it("un corps hors schéma donne null, jamais un pipeline partiel", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { modules: "fuite" },
    });

    await expect(
      recupererPipeline("flutter-firebase-debutants"),
    ).resolves.toBeNull();
  });

  it("Django injoignable : null", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 503,
      error: "api_unreachable",
    });

    await expect(
      recupererPipeline("flutter-firebase-debutants"),
    ).resolves.toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Pipeline } from "@/lib/progress-schemas";

/* Lecture serveur du pipeline (§5). `recupererPipeline` distingue « pas de session »
   de « la lecture a échoué » — l'appelant ne doit jamais confondre l'un des deux avec
   « rien n'a encore été fait » (§6, sinon un incident se présente comme un parcours
   effacé). `moduleDuChapitre` est une fonction pure, testée séparément. */

const apiFetch = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("next/headers", () => ({ cookies }));

const { recupererPipeline, moduleDuChapitre } = await import("@/lib/progress");

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
      recommande_apres_ordre: null,
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
} satisfies Pipeline;

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
    ).resolves.toEqual({
      ok: true,
      pipeline: PIPELINE,
    });
    expect(apiFetch.mock.calls[0]?.[0]).toBe(
      "/api/progress?course=flutter-firebase-debutants",
    );
  });

  it("n'est jamais mis en cache : la réponse dépend du compte", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: PIPELINE });

    await recupererPipeline("flutter-firebase-debutants");

    expect(apiFetch.mock.calls[0]?.[2]).toEqual({ acceptStatuses: [401, 404] });
  });

  it("sans session : raison distincte, sans appeler Django", async () => {
    avecSession(null);

    await expect(
      recupererPipeline("flutter-firebase-debutants"),
    ).resolves.toEqual({
      ok: false,
      raison: "sans_session",
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un 404 de Django : indisponible, pas confondu avec sans_session", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 404,
      data: { detail: "Not found." },
    });

    await expect(recupererPipeline("cours-inexistant")).resolves.toEqual({
      ok: false,
      raison: "indisponible",
    });
  });

  it("un corps hors schéma : indisponible, jamais un pipeline partiel", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { modules: "fuite" },
    });

    await expect(
      recupererPipeline("flutter-firebase-debutants"),
    ).resolves.toEqual({
      ok: false,
      raison: "indisponible",
    });
  });

  it("Django injoignable : indisponible", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 503,
      error: "api_unreachable",
    });

    await expect(
      recupererPipeline("flutter-firebase-debutants"),
    ).resolves.toEqual({
      ok: false,
      raison: "indisponible",
    });
  });
});

describe("moduleDuChapitre", () => {
  it("trouve le module contenant le chapitre", () => {
    expect(moduleDuChapitre(PIPELINE, "installer-flutter")).toEqual(
      PIPELINE.modules[0],
    );
  });

  it("renvoie null si le chapitre n'est dans aucun module", () => {
    expect(moduleDuChapitre(PIPELINE, "chapitre-inconnu")).toBeNull();
  });
});

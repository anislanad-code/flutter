import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const recupererCours = vi.hoisted(() => vi.fn());
const recupererChapitreGratuit = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));

vi.mock("@/lib/catalog", () => ({
  SLUG_FORMATION_PRINCIPALE: "flutter-firebase-debutants",
  recupererCours,
  recupererChapitreGratuit,
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { default: Landing } = await import("@/app/(marketing)/page");

const COURS = {
  slug: "flutter-firebase-debutants",
  title: "Flutter + Firebase pour débutants absolus",
  description: "Une vraie application, de zéro.",
  modules: [
    {
      id: 1,
      order: 0,
      title: "Mise en route",
      summary: "Installer l'outillage.",
      chapters: [
        { id: 1, slug: "installer-flutter", order: 1, title: "Installer Flutter", is_free: true },
      ],
    },
  ],
};

const CHAPITRE = {
  id: 1,
  slug: "installer-flutter",
  title: "Installer Flutter",
  is_free: true,
  lesson: { video_provider_id: "", duration_s: 10, transcript: "Texte.", resources: [] },
  module_title: "Mise en route",
  course_slug: "flutter-firebase-debutants",
  course_title: "Flutter + Firebase pour débutants absolus",
};

beforeEach(() => {
  recupererCours.mockReset();
  recupererChapitreGratuit.mockReset();
  notFound.mockClear();
});

describe("Landing", () => {
  it("rend le titre, la description et le parcours quand le cours existe", async () => {
    recupererCours.mockResolvedValue(COURS);
    recupererChapitreGratuit.mockResolvedValue(CHAPITRE);

    const html = renderToStaticMarkup(await Landing());

    expect(html).toContain("Flutter + Firebase pour débutants absolus");
    expect(html).toContain("Installer Flutter");
    expect(html).toContain("application/ld+json");
  });

  it("appelle notFound() quand le cours n'existe pas ou n'est pas publié", async () => {
    recupererCours.mockResolvedValue(null);
    recupererChapitreGratuit.mockResolvedValue(null);

    await expect(Landing()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("reste utilisable même si le chapitre gratuit est temporairement indisponible", async () => {
    recupererCours.mockResolvedValue(COURS);
    recupererChapitreGratuit.mockResolvedValue(null);

    const html = renderToStaticMarkup(await Landing());

    expect(html).toContain("momentanément indisponible");
  });

  it("n'injecte jamais le contenu de la leçon dans les données structurées", async () => {
    recupererCours.mockResolvedValue(COURS);
    recupererChapitreGratuit.mockResolvedValue(CHAPITRE);

    const html = renderToStaticMarkup(await Landing());
    const script = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const donnees = JSON.parse(script!);
    expect(donnees["@type"]).toBe("Course");
    expect(donnees).not.toHaveProperty("lesson");
  });
});

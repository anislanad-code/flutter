import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const recupererChapitreGratuit = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("@/lib/catalog", () => ({ recupererChapitreGratuit }));
vi.mock("next/navigation", () => ({ notFound }));

const { default: ChapitreGratuitPage, generateMetadata } =
  await import("@/app/gratuit/[chapitre]/page");

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
  recupererChapitreGratuit.mockReset();
  notFound.mockClear();
});

describe("Page /gratuit/[chapitre]", () => {
  it("rend le chapitre et un appel à l'action clair vers l'inscription", async () => {
    recupererChapitreGratuit.mockResolvedValue(CHAPITRE);

    const html = renderToStaticMarkup(
      await ChapitreGratuitPage({
        params: Promise.resolve({ chapitre: "installer-flutter" }),
      }),
    );

    expect(html).toContain("Installer Flutter");
    expect(html).toContain('href="/inscription"');
    // Pas de progression à suivre pour un visiteur anonyme (§5) : ni le bouton, ni un
    // appel à l'endpoint de complétion authentifié.
    expect(html).not.toContain("Marquer ce chapitre comme terminé");
  });

  it("appelle notFound() pour un chapitre payant ou inexistant", async () => {
    recupererChapitreGratuit.mockResolvedValue(null);

    await expect(
      ChapitreGratuitPage({ params: Promise.resolve({ chapitre: "payant" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("generateMetadata renvoie un titre neutre sans fuite quand le chapitre n'existe pas", async () => {
    recupererChapitreGratuit.mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ chapitre: "payant" }),
    });

    expect(metadata.title).toBe("Chapitre introuvable — anis.dev");
  });

  it("generateMetadata construit un titre et une URL canonique à partir du chapitre", async () => {
    recupererChapitreGratuit.mockResolvedValue(CHAPITRE);

    const metadata = await generateMetadata({
      params: Promise.resolve({ chapitre: "installer-flutter" }),
    });

    expect(metadata.title).toContain("Installer Flutter");
    expect(metadata.alternates).toEqual({
      canonical: "/gratuit/installer-flutter",
    });
  });
});

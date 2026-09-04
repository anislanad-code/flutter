import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recupererCours = vi.hoisted(() => vi.fn());
vi.mock("@/lib/catalog", () => ({
  SLUG_FORMATION_PRINCIPALE: "flutter-firebase-debutants",
  recupererCours,
}));

const environnementInitial = { ...process.env };

beforeEach(() => {
  recupererCours.mockReset();
  process.env.NEXT_PUBLIC_SITE_URL = "https://anis.dev";
});

afterEach(() => {
  process.env = { ...environnementInitial };
});

describe("sitemap", () => {
  it("liste la landing et uniquement les chapitres gratuits", async () => {
    recupererCours.mockResolvedValue({
      slug: "flutter-firebase-debutants",
      title: "T",
      description: "D",
      modules: [
        {
          id: 1,
          order: 0,
          title: "M",
          summary: "",
          chapters: [
            { id: 1, slug: "gratuit-1", order: 1, title: "A", is_free: true },
            { id: 2, slug: "payant-1", order: 2, title: "B", is_free: false },
          ],
        },
      ],
    });

    const { default: sitemap } = await import("@/app/sitemap");
    const entrees = await sitemap();

    const urls = entrees.map((e) => e.url);
    expect(urls).toContain("https://anis.dev");
    expect(urls).toContain("https://anis.dev/gratuit/gratuit-1");
    expect(urls).not.toContain("https://anis.dev/gratuit/payant-1");
  });

  it("ne casse pas quand le cours n'est pas disponible", async () => {
    recupererCours.mockResolvedValue(null);

    const { default: sitemap } = await import("@/app/sitemap");
    const entrees = await sitemap();

    expect(entrees).toEqual([{ url: "https://anis.dev", changeFrequency: "weekly", priority: 1 }]);
  });
});

describe("robots", () => {
  it("interdit /app, /admin et /api, et pointe vers le sitemap", async () => {
    const { default: robots } = await import("@/app/robots");
    const resultat = robots();

    expect(resultat.sitemap).toBe("https://anis.dev/sitemap.xml");
    const regle = Array.isArray(resultat.rules) ? resultat.rules[0] : resultat.rules;
    expect(regle?.disallow).toEqual(["/app", "/admin", "/api"]);
  });
});

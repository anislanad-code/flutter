/* Invariante de CLAUDE.md §4.4 rejouée à chaque étape, côté rendu : aucun contenu de
   chapitre payant ne doit apparaître dans le HTML servi par Next — c'est le chemin que
   `progress.md` demande explicitement de vérifier pour l'étape 2 (« API, route Next,
   HTML du SSR »). Django est déjà testé de son côté ; ici on vérifie que le front ne
   recompose pas ce que l'API a refusé de donner. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const recupererCours = vi.hoisted(() => vi.fn());
const recupererChapitreGratuit = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("@/lib/catalog", () => ({
  SLUG_FORMATION_PRINCIPALE: "flutter-firebase-debutants",
  recupererCours,
  recupererChapitreGratuit,
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { default: Landing } = await import("@/app/(marketing)/page");
const { default: PageChapitre } = await import("@/app/gratuit/[chapitre]/page");

const SECRET = "TRANSCRIPT-PAYANT-NE-DOIT-PAS-SORTIR";

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
        {
          id: 1,
          slug: "installer-flutter-et-configurer-ton-editeur",
          order: 1,
          title: "Installer Flutter",
          is_free: true,
        },
        { id: 2, slug: "ton-premier-widget", order: 2, title: "Ton premier widget", is_free: false },
      ],
    },
  ],
};

const CHAPITRE_GRATUIT = {
  id: 1,
  slug: "installer-flutter-et-configurer-ton-editeur",
  title: "Installer Flutter",
  is_free: true,
  lesson: { video_provider_id: "", duration_s: 480, transcript: "Texte libre.", resources: [] },
  module_title: "Mise en route",
  course_slug: "flutter-firebase-debutants",
  course_title: "Flutter + Firebase pour débutants absolus",
};

beforeEach(() => {
  recupererCours.mockReset();
  recupererChapitreGratuit.mockReset();
  notFound.mockClear();
});

describe("Paywall — HTML rendu côté serveur", () => {
  it("la landing n'inclut ni transcript ni identifiant vidéo d'un chapitre payant", async () => {
    recupererCours.mockResolvedValue(COURS);
    recupererChapitreGratuit.mockResolvedValue(CHAPITRE_GRATUIT);

    const html = renderToStaticMarkup(await Landing());

    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("transcript");
    expect(html).not.toContain("video_provider_id");
    // Le titre d'un chapitre payant est public (il est dans l'arbre) : c'est l'argument
    // de vente. Son contenu, non.
    expect(html).toContain("Ton premier widget");
  });

  it("la landing ne demande le contenu que d'un seul chapitre, jamais l'arbre complet", async () => {
    recupererCours.mockResolvedValue(COURS);
    recupererChapitreGratuit.mockResolvedValue(CHAPITRE_GRATUIT);

    await Landing();

    // §4.4 : « l'API de contenu renvoie un chapitre à la fois ». Un seul appel, sur le
    // seul chapitre marqué `is_free` dans l'arbre.
    expect(recupererChapitreGratuit).toHaveBeenCalledTimes(1);
    expect(recupererChapitreGratuit).toHaveBeenCalledWith(
      "installer-flutter-et-configurer-ton-editeur",
    );
  });

  it("la page /gratuit/[chapitre] rend 404 pour un slug payant, sans afficher son titre", async () => {
    // Django renvoie 404 sur un chapitre payant, donc `recupererChapitreGratuit` → null.
    recupererChapitreGratuit.mockResolvedValue(null);

    await expect(
      PageChapitre({ params: Promise.resolve({ chapitre: "ton-premier-widget" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("un chapitre marqué is_free=false qui passerait quand même l'API est refusé côté front", async () => {
    /* Défense en profondeur : `chapitreGratuitSchema` impose `is_free: true` littéral,
       donc même une réponse Django compromise ne rend pas le contenu. On simule ici la
       conséquence attendue (null → 404), le rejet du schéma étant testé dans
       `lib-catalog.test.ts`. */
    recupererChapitreGratuit.mockResolvedValue(null);

    await expect(
      PageChapitre({ params: Promise.resolve({ chapitre: "x" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("le hero suit le flag is_free de l'arbre, pas un slug écrit en dur (§4.4)", async () => {
    /* Si le slug du chapitre gratuit change en base, le hero doit suivre : l'exception
       au paywall se définit par le flag, jamais par un identifiant codé en dur. */
    recupererCours.mockResolvedValue({
      ...COURS,
      modules: [
        {
          ...COURS.modules[0],
          chapters: [
            { id: 1, slug: "slug-renomme", order: 1, title: "Installer Flutter", is_free: true },
            { id: 2, slug: "payant", order: 2, title: "Payant", is_free: false },
          ],
        },
      ],
    });
    recupererChapitreGratuit.mockResolvedValue({ ...CHAPITRE_GRATUIT, slug: "slug-renomme" });

    const html = renderToStaticMarkup(await Landing());

    expect(recupererChapitreGratuit).toHaveBeenCalledWith("slug-renomme");
    expect(html).not.toContain("momentanément indisponible");
    expect(html).toContain('href="/gratuit/slug-renomme"');
  });

  it("ne demande aucun contenu quand aucun chapitre n'est marqué gratuit", async () => {
    /* Cas limite : une formation entièrement payante. La landing reste debout, ne
       demande le contenu d'aucun chapitre, et affiche son état de repli. */
    recupererCours.mockResolvedValue({
      ...COURS,
      modules: [
        {
          ...COURS.modules[0],
          chapters: [
            { id: 2, slug: "ton-premier-widget", order: 1, title: "Payant", is_free: false },
          ],
        },
      ],
    });

    const html = renderToStaticMarkup(await Landing());

    expect(recupererChapitreGratuit).not.toHaveBeenCalled();
    expect(html).toContain("momentanément indisponible");
    expect(html).not.toContain(SECRET);
  });

  it("les données structurées ne contiennent aucun contenu de leçon", async () => {
    recupererCours.mockResolvedValue(COURS);
    recupererChapitreGratuit.mockResolvedValue({
      ...CHAPITRE_GRATUIT,
      lesson: { ...CHAPITRE_GRATUIT.lesson, transcript: SECRET },
    });

    const html = renderToStaticMarkup(await Landing());
    const script = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];

    expect(script).toBeTruthy();
    expect(script).not.toContain(SECRET);
    expect(JSON.parse(script!)).not.toHaveProperty("hasPart");
  });
});

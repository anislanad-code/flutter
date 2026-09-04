// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/* Les critères d'acceptation de l'étape 5 qui portent sur le clavier et le mouvement
   (progress.md § « Terminé quand », CLAUDE.md §6 plancher de qualité) :
   navigation complète au clavier avec focus visible, `prefers-reduced-motion` qui
   coupe l'unique animation, et un nœud « recommandé plus tard » qui reste atteignable
   au clavier comme à la souris (soft gating, §2). */

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

import type { Pipeline as PipelineType } from "@/lib/progress-schemas";

const { Pipeline } = await import("@/components/student/Pipeline");
const { BoutonTerminerChapitre } =
  await import("@/components/course/BoutonTerminerChapitre");

const PIPELINE = {
  course_slug: "flutter-firebase-debutants",
  resume_chapter_slug: "premier-widget",
  modules: [
    {
      id: 1,
      order: 0,
      title: "Mise en route",
      unlocked: true,
      completed_chapters: 1,
      total_chapters: 2,
      recommande_apres_ordre: null,
      exam_quiz_id: null,
      exam_passed: false,
      chapters: [
        {
          id: 1,
          slug: "installer-flutter",
          order: 1,
          title: "Installer Flutter",
          is_free: true,
          state: "termine",
          quiz_id: null,
        },
        {
          id: 2,
          slug: "premier-widget",
          order: 2,
          title: "Premier widget",
          is_free: false,
          state: "en_cours",
          quiz_id: null,
        },
      ],
    },
    {
      id: 2,
      order: 1,
      title: "Premiers écrans",
      unlocked: false,
      completed_chapters: 0,
      total_chapters: 1,
      recommande_apres_ordre: 0,
      exam_quiz_id: null,
      exam_passed: false,
      chapters: [
        {
          id: 3,
          slug: "premier-ecran",
          order: 1,
          title: "Premier écran",
          is_free: false,
          state: "recommande_plus_tard",
          quiz_id: null,
        },
      ],
    },
  ],
} satisfies PipelineType;

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Pipeline — navigation clavier", () => {
  it("chaque chapitre est un lien atteignable au clavier, aucun n'est retiré de l'ordre de tabulation", () => {
    render(<Pipeline pipeline={PIPELINE} />);

    const liens = screen.getAllByRole("link");
    // Reprendre + les trois chapitres.
    expect(liens).toHaveLength(4);
    for (const lien of liens) {
      expect(lien.tagName).toBe("A");
      expect(lien.getAttribute("href")).toBeTruthy();
      expect(lien.getAttribute("tabindex")).toBeNull();
      expect(lien.getAttribute("aria-disabled")).toBeNull();
      expect(lien.className).not.toContain("pointer-events-none");
    }
  });

  it("l'ordre de tabulation suit l'ordre du parcours, module par module", () => {
    render(<Pipeline pipeline={PIPELINE} />);

    const titres = screen
      .getAllByRole("link")
      .map((lien) => lien.getAttribute("href"));
    expect(titres).toEqual([
      "/app/chapitre/premier-widget",
      "/app/chapitre/installer-flutter",
      "/app/chapitre/premier-widget",
      "/app/chapitre/premier-ecran",
    ]);
  });

  it("un nœud recommandé plus tard prend le focus comme les autres", () => {
    render(<Pipeline pipeline={PIPELINE} />);

    const lien = screen.getByRole("link", { name: /Premier écran/ });
    lien.focus();
    expect(document.activeElement).toBe(lien);
  });

  it("le marqueur visuel du nœud est décoratif : jamais dans l'arbre d'accessibilité", () => {
    const { container } = render(<Pipeline pipeline={PIPELINE} />);

    const marqueurs = container.querySelectorAll('span[aria-hidden="true"]');
    expect(marqueurs).toHaveLength(3);
    // L'état reste lisible pour un lecteur d'écran par le texte, pas par la couleur.
    expect(screen.getByText(/— en cours/)).toBeTruthy();
    expect(screen.getByText(/— recommandé plus tard/)).toBeTruthy();
  });

  it("la liste est une vraie liste ordonnée imbriquée, pas une pile de div", () => {
    const { container } = render(<Pipeline pipeline={PIPELINE} />);

    expect(container.querySelectorAll("ol")).toHaveLength(3);
    expect(container.querySelectorAll("li").length).toBe(5);
  });
});

describe("Pipeline — unique animation de complétion", () => {
  it("le nœud qui vient d'être terminé porte la classe d'animation", () => {
    const { container } = render(
      <Pipeline
        pipeline={PIPELINE}
        chapitreVientDeTerminer="installer-flutter"
      />,
    );

    expect(container.querySelectorAll(".noeud-vient-de-terminer")).toHaveLength(
      1,
    );
  });

  it("aucun nœud n'est animé quand on arrive sur la page sans paramètre", () => {
    const { container } = render(<Pipeline pipeline={PIPELINE} />);

    expect(container.querySelector(".noeud-vient-de-terminer")).toBeNull();
  });

  it("un slug qui ne correspond à aucun chapitre n'anime rien", () => {
    const { container } = render(
      <Pipeline
        pipeline={PIPELINE}
        chapitreVientDeTerminer="chapitre-fantome"
      />,
    );

    expect(container.querySelector(".noeud-vient-de-terminer")).toBeNull();
  });

  it("un chapitre encore en cours ne s'anime pas, même désigné par le paramètre", () => {
    const { container } = render(
      <Pipeline pipeline={PIPELINE} chapitreVientDeTerminer="premier-widget" />,
    );

    expect(container.querySelector(".noeud-vient-de-terminer")).toBeNull();
  });
});

describe("Pipeline — cas limites d'affichage", () => {
  it("un module sans chapitre affiche 0 % sans NaN", () => {
    const vide = {
      ...PIPELINE,
      resume_chapter_slug: null,
      modules: [
        {
          id: 9,
          order: 3,
          title: "En préparation",
          unlocked: false,
          completed_chapters: 0,
          total_chapters: 0,
          recommande_apres_ordre: 2,
      exam_quiz_id: null,
      exam_passed: false,
          chapters: [],
        },
      ],
    } satisfies PipelineType;

    render(<Pipeline pipeline={vide} />);

    const barre = screen.getByRole("progressbar", {
      name: "Progression du module 3",
    });
    expect(barre.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("0/0")).toBeTruthy();
  });

  it("un module entièrement terminé affiche 100 %", () => {
    const module0 = PIPELINE.modules[0]!;
    const complet = {
      ...PIPELINE,
      resume_chapter_slug: null,
      modules: [
        {
          ...module0,
          completed_chapters: 2,
          chapters: module0.chapters.map((c) => ({
            ...c,
            state: "termine" as const,
          })),
        },
      ],
    } satisfies PipelineType;

    render(<Pipeline pipeline={complet} />);
    expect(
      screen
        .getByRole("progressbar", { name: "Progression du module 0" })
        .getAttribute("aria-valuenow"),
    ).toBe("100");
  });

  it("un pipeline sans aucun module ne rend aucun nœud et ne plante pas", () => {
    const vide = {
      course_slug: "flutter-firebase-debutants",
      resume_chapter_slug: null,
      modules: [],
    } satisfies PipelineType;

    render(<Pipeline pipeline={vide} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(
      screen.getByText(/Tous les chapitres disponibles sont terminés/),
    ).toBeTruthy();
  });
});

describe("BoutonTerminerChapitre — clavier et état de chargement", () => {
  it("affiche l'état de chargement et se désactive pendant l'appel", async () => {
    let debloquer: (reponse: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        debloquer = resolve;
      }),
    );

    render(<BoutonTerminerChapitre chapitreSlug="installer-flutter" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Marquer ce chapitre comme terminé" }),
    );

    const bouton = await screen.findByRole("button", {
      name: "Enregistrement…",
    });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);

    debloquer(new Response(null, { status: 200 }));
    await waitFor(() =>
      expect(screen.getByText("Chapitre marqué terminé.")).toBeTruthy(),
    );
    // Un seul appel, même si le bouton est martelé pendant le chargement.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("est un vrai bouton : Entrée et Espace le déclenchent nativement", () => {
    render(<BoutonTerminerChapitre chapitreSlug="installer-flutter" />);

    const bouton = screen.getByRole("button", {
      name: "Marquer ce chapitre comme terminé",
    });
    expect(bouton.tagName).toBe("BUTTON");
    expect(bouton.getAttribute("type")).toBe("button");
    expect(bouton.getAttribute("tabindex")).toBeNull();
    bouton.focus();
    expect(document.activeElement).toBe(bouton);
  });

  it("échappe le slug dans l'URL du BFF et dans le retour vers le pipeline", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

    render(<BoutonTerminerChapitre chapitreSlug="a b/../c" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Marquer ce chapitre comme terminé" }),
    );

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/chapters/a%20b%2F..%2Fc/complete",
      { method: "POST" },
    );
    expect(push).toHaveBeenCalledWith("/app?termine=a%20b%2F..%2Fc");
  });

  it("un 429 affiche le même message clair qu'une panne, sans détail technique", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Trop de tentatives." }), {
        status: 429,
      }),
    );

    render(<BoutonTerminerChapitre chapitreSlug="installer-flutter" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Marquer ce chapitre comme terminé" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/Impossible d'enregistrer/)).toBeTruthy(),
    );
    expect(push).not.toHaveBeenCalled();
    // Le bouton reste utilisable pour réessayer.
    expect(
      screen.getByRole("button", { name: "Marquer ce chapitre comme terminé" }),
    ).toBeTruthy();
  });
});

describe("invariantes visuelles du §6 dans globals.css", () => {
  it("prefers-reduced-motion neutralise l'animation de complétion", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    const bloc = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(bloc).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(bloc).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(bloc).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("l'animation du nœud terminé existe et reste la seule de l'app", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain(".noeud-vient-de-terminer");
    expect(css).toContain("@keyframes noeud-termine");
    // Une seule règle `animation:` dans toute la feuille globale.
    expect(css.match(/^\s*animation:/gm) ?? []).toHaveLength(1);
  });

  it("le focus clavier est visible partout", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain(":focus-visible");
    expect(css).toMatch(/outline:\s*2px solid var\(--zellige\)/);
    expect(css).not.toMatch(/outline:\s*none/);
  });

  it("les composants du pipeline n'utilisent aucune couleur en dur (§7)", async () => {
    const { readFileSync } = await import("node:fs");

    for (const fichier of [
      "components/student/Pipeline.tsx",
      "components/student/NoeudPipeline.tsx",
      "components/course/BoutonTerminerChapitre.tsx",
    ]) {
      const source = readFileSync(fichier, "utf8");
      expect(source, `${fichier} contient une valeur hexadécimale`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
    }
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/* Les composants du pipeline (§5). Ce qui compte : les quatre états s'affichent
   distinctement, un nœud « recommandé plus tard » reste cliquable (soft gating, §2),
   et le bouton de complétion dit ce qu'il fait puis le confirme (§6). */

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

describe("Pipeline", () => {
  it("affiche le bouton Reprendre vers le chapitre en cours", () => {
    render(<Pipeline pipeline={PIPELINE} />);

    const bouton = screen.getByRole("link", { name: "Reprendre" });
    expect(bouton.getAttribute("href")).toBe("/app/chapitre/premier-widget");
  });

  it("affiche Commencer quand rien n'a jamais été entamé", () => {
    const module0 = PIPELINE.modules[0]!;
    const vierge = {
      ...PIPELINE,
      modules: [
        {
          ...module0,
          completed_chapters: 0,
          chapters: module0.chapters.map((c) => ({
            ...c,
            state: "disponible" as const,
          })),
        },
      ],
      resume_chapter_slug: "installer-flutter",
    } satisfies PipelineType;

    render(<Pipeline pipeline={vierge} />);
    expect(screen.getByRole("link", { name: "Commencer" })).toBeTruthy();
  });

  it("propose l'examen du module quand il en a un et qu'il n'est pas encore réussi", () => {
    const avecExamen = {
      ...PIPELINE,
      modules: [{ ...PIPELINE.modules[0]!, exam_quiz_id: 7, exam_passed: false }],
    } satisfies PipelineType;

    render(<Pipeline pipeline={avecExamen} />);

    const lien = screen.getByRole("link", { name: "Passer l'examen du module" });
    expect(lien.getAttribute("href")).toBe("/app/qcm/7");
  });

  it("affiche un badge de réussite plutôt qu'un lien une fois l'examen réussi", () => {
    const examenReussi = {
      ...PIPELINE,
      modules: [{ ...PIPELINE.modules[0]!, exam_quiz_id: 7, exam_passed: true }],
    } satisfies PipelineType;

    render(<Pipeline pipeline={examenReussi} />);

    expect(screen.getByText("Examen du module réussi.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Passer l'examen du module" })).toBeNull();
  });

  it("un module recommandé plus tard reste cliquable, jamais un cadenas", () => {
    render(<Pipeline pipeline={PIPELINE} />);

    const lien = screen.getByRole("link", { name: /Premier écran/ });
    expect(lien.tagName).toBe("A");
    expect(lien.getAttribute("href")).toBe("/app/chapitre/premier-ecran");
  });

  it("désigne le bon module dans la recommandation, visible sans survol ni title", () => {
    render(<Pipeline pipeline={PIPELINE} />);

    // Le module verrouillé est le module 1 ; celui qui le déverrouillerait est le
    // module 0 (`recommande_apres_ordre`) — jamais le module qu'on est en train
    // d'ouvrir. Rendu en texte permanent, pas dans un attribut `title` (invisible au
    // clavier et au tactile).
    const recommandation = screen.getByText("Termine d'abord le module 0.");
    expect(recommandation.tagName).toBe("P");
  });

  it("annonce l'état de chaque chapitre pour un lecteur d'écran", () => {
    render(<Pipeline pipeline={PIPELINE} />);
    expect(screen.getByText(/— terminé/)).toBeTruthy();
    expect(screen.getByText(/— recommandé plus tard/)).toBeTruthy();
  });

  it("expose la progression du module en pourcentage accessible", () => {
    render(<Pipeline pipeline={PIPELINE} />);
    const barre = screen.getByRole("progressbar", {
      name: "Progression du module 0",
    });
    expect(barre.getAttribute("aria-valuenow")).toBe("50");
  });

  it("quand tout est terminé : pas de bouton Reprendre", () => {
    const complet = { ...PIPELINE, resume_chapter_slug: null };
    render(<Pipeline pipeline={complet} />);
    expect(
      screen.queryByRole("link", { name: /Reprendre|Commencer/ }),
    ).toBeNull();
    expect(
      screen.getByText(/Tous les chapitres disponibles sont terminés/),
    ).toBeTruthy();
  });
});

describe("BoutonTerminerChapitre", () => {
  it("marque le chapitre terminé et revient au pipeline avec le paramètre `termine`", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

    render(<BoutonTerminerChapitre chapitreSlug="installer-flutter" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Marquer ce chapitre comme terminé" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Chapitre marqué terminé.")).toBeTruthy(),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/chapters/installer-flutter/complete",
      {
        method: "POST",
      },
    );
    expect(push).toHaveBeenCalledWith("/app?termine=installer-flutter");
  });

  it("un échec réseau affiche un message clair, pas une page cassée", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    render(<BoutonTerminerChapitre chapitreSlug="installer-flutter" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Marquer ce chapitre comme terminé" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/Impossible d'enregistrer/)).toBeTruthy(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("un statut d'erreur du BFF affiche aussi le message clair", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));

    render(<BoutonTerminerChapitre chapitreSlug="premier-widget" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Marquer ce chapitre comme terminé" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/Impossible d'enregistrer/)).toBeTruthy(),
    );
  });
});

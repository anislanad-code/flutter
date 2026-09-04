// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/* Compléments à `qcm-page.test.tsx` et `lib-assessment.test.ts` : l'écran d'examen de
   module (titre distinct de celui d'un QCM de chapitre), les identifiants d'URL hors
   forme, et le statut 429 côté lecture serveur — qui doit devenir « indisponible » et
   non « inaccessible », sans quoi un simple excès de débit ferait croire à l'étudiant
   que son QCM n'existe pas. */

const utilisateurCourant = vi.hoisted(() => vi.fn());
const recupererQuiz = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((cible: string) => {
    throw new Error(`REDIRECT:${cible}`);
  }),
);
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("@/lib/current-user", () => ({ utilisateurCourant }));
vi.mock("@/lib/assessment", () => ({ recupererQuiz }));
vi.mock("next/navigation", () => ({
  redirect,
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: PageQcm } = await import("@/app/(student)/app/qcm/[id]/page");

const ETUDIANTE = {
  id: 7,
  email: "etudiante@example.com",
  phone: "0550112233",
  is_staff: false,
  created_at: "2026-01-01T00:00:00Z",
  last_activity_at: null,
};

const QUIZ = {
  id: 1,
  kind: "chapitre" as const,
  pass_threshold: 60,
  max_attempts: 3,
  min_duration_s: 20,
  attempts_used: 0,
  attempts_remaining: 3,
  best_score: null,
  questions: [],
};

beforeEach(() => {
  utilisateurCourant.mockReset();
  recupererQuiz.mockReset();
  utilisateurCourant.mockResolvedValue(ETUDIANTE);
});

afterEach(() => cleanup());

describe("PageQcm — cas limites", () => {
  it("un examen de module s'annonce comme tel, pas comme un QCM de chapitre", async () => {
    recupererQuiz.mockResolvedValue({
      ok: true,
      quiz: { ...QUIZ, kind: "examen" as const },
    });

    render(await PageQcm({ params: Promise.resolve({ id: "1" }) }));

    expect(screen.getByRole("heading", { name: "Examen de module" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "QCM de chapitre" })).toBeNull();
  });

  it.each(["0", "-3", "1.5", " ", "", "%2e%2e", "../me", "1;drop"])(
    "l'identifiant « %s » est refusé sans aucun appel serveur",
    async (id) => {
      await expect(PageQcm({ params: Promise.resolve({ id }) })).rejects.toThrow(
        "NOT_FOUND",
      );
      expect(recupererQuiz).not.toHaveBeenCalled();
    },
  );

  it("l'absence de session redirige avant toute lecture, en conservant l'id", async () => {
    utilisateurCourant.mockResolvedValue(null);

    await expect(PageQcm({ params: Promise.resolve({ id: "12" }) })).rejects.toThrow(
      "REDIRECT:/connexion?suite=/app/qcm/12",
    );
    expect(recupererQuiz).not.toHaveBeenCalled();
  });

  it("la page ne rend jamais de contenu de quiz quand la lecture a échoué", async () => {
    recupererQuiz.mockResolvedValue({ ok: false, raison: "indisponible" });

    const { container } = render(
      await PageQcm({ params: Promise.resolve({ id: "1" }) }),
    );

    expect(container.querySelector("fieldset")).toBeNull();
    expect(screen.queryByRole("button", { name: "Commencer" })).toBeNull();
    expect(screen.getByRole("link", { name: "Retour à ton parcours" })).toBeTruthy();
  });

  it("« sans_session » ne se confond pas avec « inaccessible » : message, pas 404", async () => {
    recupererQuiz.mockResolvedValue({ ok: false, raison: "sans_session" });

    render(await PageQcm({ params: Promise.resolve({ id: "1" }) }));

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

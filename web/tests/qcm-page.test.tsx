// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/* La page de QCM (étape 6). Ce qu'elle doit prouver : pas de session → redirection
   (avec la destination conservée), un id qui n'a pas la forme d'un entier positif ou un
   quiz inaccessible (paywall, IDOR — 404 Django) → 404 propre, un incident de lecture
   → message clair plutôt qu'une page cassée, jamais une confusion entre les trois. */

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
});

afterEach(() => cleanup());

describe("PageQcm", () => {
  it("redirige vers la connexion en conservant la destination quand il n'y a pas de session", async () => {
    utilisateurCourant.mockResolvedValue(null);

    await expect(
      PageQcm({ params: Promise.resolve({ id: "1" }) }),
    ).rejects.toThrow("REDIRECT:/connexion?suite=/app/qcm/1");
  });

  it("404 sur un id qui n'a pas la forme d'un entier positif, sans appeler Django", async () => {
    utilisateurCourant.mockResolvedValue(ETUDIANTE);

    await expect(
      PageQcm({ params: Promise.resolve({ id: "pas-un-id" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(recupererQuiz).not.toHaveBeenCalled();
  });

  it("404 quand le quiz est inaccessible (paywall ou IDOR) — même verdict qu'un id inexistant", async () => {
    utilisateurCourant.mockResolvedValue(ETUDIANTE);
    recupererQuiz.mockResolvedValue({ ok: false, raison: "inaccessible" });

    await expect(
      PageQcm({ params: Promise.resolve({ id: "1" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("un incident de lecture affiche un message clair, pas une page cassée", async () => {
    utilisateurCourant.mockResolvedValue(ETUDIANTE);
    recupererQuiz.mockResolvedValue({ ok: false, raison: "indisponible" });

    const jsx = await PageQcm({ params: Promise.resolve({ id: "1" }) });
    render(jsx);

    expect(screen.getByRole("alert").textContent).toMatch(/n'a pas pu être chargé/);
  });

  it("affiche le composant Qcm quand la lecture réussit", async () => {
    utilisateurCourant.mockResolvedValue(ETUDIANTE);
    recupererQuiz.mockResolvedValue({ ok: true, quiz: QUIZ });

    const jsx = await PageQcm({ params: Promise.resolve({ id: "1" }) });
    render(jsx);

    expect(screen.getByRole("heading", { name: "QCM de chapitre" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Retour à ton parcours" })).toBeTruthy();
  });
});

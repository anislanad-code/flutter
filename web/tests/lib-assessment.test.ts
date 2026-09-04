import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EtatQuiz } from "@/lib/assessment-schemas";

/* Lecture serveur d'un quiz (§6). `recupererQuiz` distingue « pas de session »,
   « inaccessible » (paywall, id inexistant — 404 Django) et « la lecture a échoué »,
   comme `recupererPipeline` (étape 5) le fait déjà pour le pipeline. */

const apiFetch = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("next/headers", () => ({ cookies }));

const { recupererQuiz } = await import("@/lib/assessment");

const QUIZ = {
  id: 1,
  kind: "chapitre",
  pass_threshold: 60,
  max_attempts: 3,
  min_duration_s: 20,
  attempts_used: 0,
  attempts_remaining: 3,
  best_score: null,
  questions: [
    {
      id: 10,
      order: 1,
      text: "Une question ?",
      choices: [
        { id: 100, text: "Réponse A" },
        { id: 101, text: "Réponse B" },
      ],
    },
  ],
} satisfies EtatQuiz;

function avecSession(valeur: string | null): void {
  cookies.mockResolvedValue({
    get: (nom: string) => (valeur && nom === "session" ? { value: valeur } : undefined),
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  cookies.mockReset();
  avecSession("jeton-de-session");
});

describe("recupererQuiz", () => {
  it("renvoie le quiz quand la réponse est valide", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: QUIZ });

    const resultat = await recupererQuiz(1);

    expect(resultat).toEqual({ ok: true, quiz: QUIZ });
  });

  it("sans session : ne tente pas l'appel", async () => {
    avecSession(null);

    const resultat = await recupererQuiz(1);

    expect(resultat).toEqual({ ok: false, raison: "sans_session" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("404 (paywall ou id inexistant) : inaccessible, jamais confondu avec un incident", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    const resultat = await recupererQuiz(1);

    expect(resultat).toEqual({ ok: false, raison: "inaccessible" });
  });

  it("Django injoignable : indisponible", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, error: "api_unreachable" });

    const resultat = await recupererQuiz(1);

    expect(resultat).toEqual({ ok: false, raison: "indisponible" });
  });

  it("une réponse hors schéma (champ requis manquant) est refusée, pas affichée telle quelle", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...QUIZ, questions: [{ id: 10, order: 1 }] },
    });

    const resultat = await recupererQuiz(1);

    expect(resultat).toEqual({ ok: false, raison: "indisponible" });
  });

  it("un 429 devient « indisponible », jamais « inaccessible »", async () => {
    /* Un excès de débit ne doit pas se transformer en 404 côté page : l'étudiant
       croirait que son QCM n'existe pas au lieu de savoir qu'il doit réessayer. */
    apiFetch.mockResolvedValue({
      ok: true,
      status: 429,
      data: { detail: "Trop de tentatives. Réessaie plus tard." },
    });

    const resultat = await recupererQuiz(1);

    expect(resultat).toEqual({ ok: false, raison: "indisponible" });
  });

  it("un 401 (session expirée entre-temps) devient « indisponible », pas un quiz vide", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: { detail: "Non authentifié." } });

    const resultat = await recupererQuiz(1);

    expect(resultat).toEqual({ ok: false, raison: "indisponible" });
  });

  it("le quiz demandé est celui de l'identifiant, sans en-tête forgé ni cache", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: QUIZ });

    await recupererQuiz(42);

    expect(apiFetch).toHaveBeenCalledWith("/api/quizzes/42", expect.anything(), {
      acceptStatuses: [401, 404, 429],
    });
  });

  it("un champ interne parasite (ex. is_correct) est filtré par le schéma, jamais relayé", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...QUIZ,
        questions: [
          {
            ...QUIZ.questions[0],
            choices: QUIZ.questions[0]!.choices.map((c) => ({ ...c, is_correct: true })),
          },
        ],
      },
    });

    const resultat = await recupererQuiz(1);

    expect(resultat.ok).toBe(true);
    expect(JSON.stringify(resultat)).not.toContain("is_correct");
  });
});

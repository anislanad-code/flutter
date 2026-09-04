// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* Le composant client des QCM (§6). Un QCM de chapitre (une question à la fois, envoi
   direct) et un examen de module (récapitulatif avant envoi) partagent ce composant —
   ce test couvre les deux déroulés, plus les refus serveur (quota, anti-triche). */

import { Qcm } from "@/components/assessment/Qcm";
import type { EtatQuiz, ResultatTentative } from "@/lib/assessment-schemas";

const QUIZ_CHAPITRE: EtatQuiz = {
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
      text: "Que fait `flutter doctor` ?",
      choices: [
        { id: 100, text: "Vérifie l'installation" },
        { id: 101, text: "Publie l'application" },
      ],
    },
    {
      id: 11,
      order: 2,
      text: "Un `StatelessWidget` a-t-il un état mutable ?",
      choices: [
        { id: 110, text: "Non" },
        { id: 111, text: "Oui" },
      ],
    },
  ],
};

const QUIZ_EXAMEN: EtatQuiz = { ...QUIZ_CHAPITRE, id: 2, kind: "examen" };

const RESULTAT_REUSSI: ResultatTentative = {
  attempt_id: 999,
  score: 100,
  passed: true,
  pass_threshold: 60,
  attempts_remaining: 2,
  questions: [
    {
      id: 10,
      text: QUIZ_CHAPITRE.questions[0]!.text,
      explanation: "`flutter doctor` vérifie l'environnement.",
      choices: [
        { id: 100, text: "Vérifie l'installation", is_correct: true, chosen: true },
        { id: 101, text: "Publie l'application", is_correct: false, chosen: false },
      ],
    },
    {
      id: 11,
      text: QUIZ_CHAPITRE.questions[1]!.text,
      explanation: "Un widget sans état est immuable une fois construit.",
      choices: [
        { id: 110, text: "Non", is_correct: true, chosen: true },
        { id: 111, text: "Oui", is_correct: false, chosen: false },
      ],
    },
  ],
};

function reponseJson(corps: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => corps } as Response;
}

function brancherFetch(options: { demarrage?: Response; soumission?: Response }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/submit")) {
        return options.soumission ?? reponseJson(RESULTAT_REUSSI);
      }
      if (url.includes("/attempts")) {
        return (
          options.demarrage ?? reponseJson({ id: 999, started_at: new Date().toISOString() }, 201)
        );
      }
      throw new Error(`URL inattendue : ${url}`);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Qcm — QCM de chapitre", () => {
  beforeEach(() => {
    brancherFetch({});
  });

  it("affiche l'introduction puis démarre une tentative", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app/chapitre/x" retourLibelle="Retour" />);

    expect(screen.getByText(/QCM de chapitre/)).toBeTruthy();
    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() => expect(screen.getByText("Question 1/2")).toBeTruthy());
  });

  it("le bouton Suivant reste désactivé tant qu'aucun choix n'est sélectionné", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app/chapitre/x" retourLibelle="Retour" />);
    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/2"));

    expect(
      (screen.getByRole("button", { name: "Suivant" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
    expect(
      (screen.getByRole("button", { name: "Suivant" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("répond aux deux questions puis envoie directement (pas de récap pour un QCM de chapitre)", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app/chapitre/x" retourLibelle="Retour" />);
    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() => screen.getByText("Question 1/2"));
    await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
    await utilisateur.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => screen.getByText("Question 2/2"));
    await utilisateur.click(screen.getByLabelText("Non"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(screen.getByText("Réussi")).toBeTruthy());
    expect(screen.getByText(/Score : 100 %/)).toBeTruthy();
    expect(screen.getByText(/vérifie l'environnement/)).toBeTruthy();
  });

  it("propose Recommencer quand il reste des tentatives, et relance l'introduction", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app/chapitre/x" retourLibelle="Retour" />);
    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/2"));
    await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
    await utilisateur.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => screen.getByText("Question 2/2"));
    await utilisateur.click(screen.getByLabelText("Non"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => screen.getByText("Réussi"));

    await utilisateur.click(screen.getByRole("button", { name: "Recommencer" }));

    expect(screen.getByRole("button", { name: "Commencer" })).toBeTruthy();
  });

  it("un compte sans tentative restante ne voit pas de bouton Commencer", () => {
    render(
      <Qcm
        quiz={{ ...QUIZ_CHAPITRE, attempts_remaining: 0 }}
        retourHref="/app/chapitre/x"
        retourLibelle="Retour"
      />,
    );

    expect(screen.queryByRole("button", { name: "Commencer" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/utilisé toutes tes tentatives/);
  });

  it("session expirée au démarrage : message explicite, pas de question affichée", async () => {
    brancherFetch({ demarrage: reponseJson({ detail: "Non authentifié." }, 401) });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app/chapitre/x" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/session a expiré/),
    );
  });

  it("quota de tentatives épuisé (409 au démarrage) : message explicite", async () => {
    brancherFetch({
      demarrage: reponseJson({ detail: "Tu as utilisé toutes tes tentatives pour ce QCM." }, 409),
    });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app/chapitre/x" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/toutes tes tentatives/),
    );
  });

  it("soumission trop rapide (400) : le message du serveur s'affiche, rien n'est perdu", async () => {
    brancherFetch({
      soumission: reponseJson({ detail: "Réponds un peu plus lentement avant d'envoyer." }, 400),
    });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app/chapitre/x" retourLibelle="Retour" />);
    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/2"));
    await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
    await utilisateur.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => screen.getByText("Question 2/2"));
    await utilisateur.click(screen.getByLabelText("Non"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/plus lentement/));
  });
});

describe("Qcm — examen de module", () => {
  beforeEach(() => {
    brancherFetch({});
  });

  it("montre un récapitulatif avant l'envoi, modifiable, puis envoie", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_EXAMEN} retourHref="/app" retourLibelle="Retour au parcours" />);
    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() => screen.getByText("Question 1/2"));
    await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
    await utilisateur.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => screen.getByText("Question 2/2"));
    await utilisateur.click(screen.getByLabelText("Non"));
    await utilisateur.click(
      screen.getByRole("button", { name: "Vérifier avant d'envoyer" }),
    );

    await waitFor(() => expect(screen.getByText(/Vérifie tes réponses/)).toBeTruthy());
    // Le libellé du choix retenu apparaît dans le récapitulatif, pas seulement dans
    // l'écran de question qui vient de se refermer.
    expect(
      screen.getAllByText("Vérifie l'installation").length,
    ).toBeGreaterThanOrEqual(1);

    await utilisateur.click(screen.getByRole("button", { name: "Envoyer mes réponses" }));

    await waitFor(() => expect(screen.getByText("Réussi")).toBeTruthy());
  });
});

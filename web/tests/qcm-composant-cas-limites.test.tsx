// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* Compléments à `qcm-composant.test.tsx` (étape 6). Ce fichier couvre ce que le premier
   laissait de côté : chaque chemin d'erreur du composant (réseau, corps hors schéma,
   échec générique, session expirée à l'envoi), les états de chargement, la navigation
   clavier complète, le retour arrière dans le questionnaire, la modification depuis le
   récapitulatif d'examen, et le rendu de l'écran de résultat dans ses variantes
   (échec, dernière tentative, explication absente, texte hostile). */

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

const RESULTAT_ECHOUE: ResultatTentative = {
  attempt_id: 999,
  score: 50,
  passed: false,
  pass_threshold: 60,
  attempts_remaining: 1,
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
      explanation: "",
      choices: [
        { id: 110, text: "Non", is_correct: true, chosen: false },
        { id: 111, text: "Oui", is_correct: false, chosen: true },
      ],
    },
  ],
};

function reponseJson(corps: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => corps } as Response;
}

function brancherFetch(options: {
  demarrage?: Response | Error;
  soumission?: Response | Error;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const choisi = url.includes("/submit") ? options.soumission : options.demarrage;
      if (choisi instanceof Error) throw choisi;
      if (choisi) return choisi;
      return url.includes("/submit")
        ? reponseJson(RESULTAT_ECHOUE)
        : reponseJson({ id: 999, started_at: new Date().toISOString() }, 201);
    }),
  );
}

/** Démarre la tentative et répond aux deux questions ; s'arrête avant l'envoi. */
async function repondreAuxDeuxQuestions(
  utilisateur: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
  await waitFor(() => screen.getByText("Question 1/2"));
  await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
  await utilisateur.click(screen.getByRole("button", { name: "Suivant" }));
  await waitFor(() => screen.getByText("Question 2/2"));
  await utilisateur.click(screen.getByLabelText("Non"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Qcm — chemins d'erreur du démarrage", () => {
  it("un échec générique du serveur affiche un message d'erreur, pas une page blanche", async () => {
    brancherFetch({ demarrage: reponseJson({ detail: "Boum." }, 500) });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Quelque chose a échoué/),
    );
    expect(screen.getByRole("link", { name: "Retour" })).toBeTruthy();
  });

  it("un corps hors schéma au démarrage est refusé plutôt qu'affiché à moitié", async () => {
    brancherFetch({ demarrage: reponseJson({ pas: "une tentative" }, 201) });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Réponse inattendue/),
    );
  });

  it("une coupure réseau au démarrage ne laisse pas le bouton en « Préparation… »", async () => {
    brancherFetch({ demarrage: new Error("réseau coupé") });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Quelque chose a échoué/),
    );
    expect(screen.queryByRole("button", { name: "Préparation…" })).toBeNull();
  });

  it("le bouton passe en « Préparation… » et se désactive pendant l'appel", async () => {
    let debloquer: (() => void) | null = null;
    const attente = new Promise<void>((resoudre) => {
      debloquer = resoudre;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await attente;
        return reponseJson({ id: 1, started_at: "2026-01-01T00:00:00Z" }, 201);
      }),
    );
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));

    const bouton = (await screen.findByRole("button", {
      name: "Préparation…",
    })) as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);

    debloquer!();
    await waitFor(() => screen.getByText("Question 1/2"));
  });
});

describe("Qcm — chemins d'erreur de la soumission", () => {
  it("session expirée à l'envoi : message dédié, différent de celui du démarrage", async () => {
    brancherFetch({ soumission: reponseJson({ detail: "Non authentifié." }, 401) });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/voir ton résultat/),
    );
  });

  it("un 400 sans corps exploitable retombe sur le message d'anti-triche par défaut", async () => {
    brancherFetch({
      soumission: {
        ok: false,
        status: 400,
        json: async () => {
          throw new Error("corps illisible");
        },
      } as Response,
    });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/plus lentement/),
    );
  });

  it("une double soumission refusée par le serveur (409) affiche le message générique", async () => {
    brancherFetch({ soumission: reponseJson({ detail: "Déjà corrigée." }, 409) });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Quelque chose a échoué/),
    );
  });

  it("un résultat hors schéma est refusé : aucun score inventé n'est affiché", async () => {
    brancherFetch({ soumission: reponseJson({ score: "beaucoup" }) });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Réponse inattendue/),
    );
    expect(screen.queryByText(/Score :/)).toBeNull();
  });

  it("une coupure réseau à l'envoi affiche l'erreur générique", async () => {
    brancherFetch({ soumission: new Error("réseau coupé") });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Quelque chose a échoué/),
    );
  });

  it("l'état d'envoi est annoncé aux lecteurs d'écran (`role=status`)", async () => {
    let debloquer: (() => void) | null = null;
    const attente = new Promise<void>((resoudre) => {
      debloquer = resoudre;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/submit")) {
          await attente;
          return reponseJson(RESULTAT_ECHOUE);
        }
        return reponseJson({ id: 1, started_at: "2026-01-01T00:00:00Z" }, 201);
      }),
    );
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    expect((await screen.findByRole("status")).textContent).toMatch(/Envoi de tes réponses/);

    debloquer!();
    await waitFor(() => screen.getByText(/Score : 50 %/));
  });
});

describe("Qcm — écran de résultat", () => {
  beforeEach(() => brancherFetch({}));

  it("un échec affiche le seuil requis et la bonne réponse de chaque question ratée", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Score insuffisant — 60 % requis/ }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Bonne réponse.")).toBeTruthy();
    expect(screen.getByText("Bonne réponse : Non")).toBeTruthy();
  });

  it("une question sans explication n'affiche pas de paragraphe vide", async () => {
    const utilisateur = userEvent.setup();
    const { container } = render(
      <Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />,
    );

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => screen.getByText(/Score : 50 %/));

    const paragraphesVides = [...container.querySelectorAll("p")].filter(
      (p) => p.textContent === "",
    );
    expect(paragraphesVides).toHaveLength(0);
  });

  it("sans tentative restante, l'écran de résultat ne propose pas de recommencer", async () => {
    brancherFetch({
      soumission: reponseJson({ ...RESULTAT_ECHOUE, attempts_remaining: 0 }),
    });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => screen.getByText(/Score : 50 %/));

    expect(screen.queryByRole("button", { name: "Recommencer" })).toBeNull();
    expect(screen.getByRole("link", { name: "Retour" })).toBeTruthy();
  });

  it("après un échec avec tentative restante, Recommencer ramène à une intro utilisable", async () => {
    /* Le quota affiché après un retour à l'intro vient de la correction (`state`
       `attemptsRestantes`), pas du rendu serveur initial : ici le serveur dit 1, la
       page était partie de 3, et l'écran d'intro reste proposable. Un quota tombé à 0
       n'est jamais atteignable par ce chemin, puisque « Recommencer » disparaît — cf.
       le test précédent. */
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => screen.getByText(/Score : 50 %/));
    await utilisateur.click(screen.getByRole("button", { name: "Recommencer" }));

    expect(screen.getByRole("button", { name: "Commencer" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("le meilleur score déjà obtenu est rappelé sur l'écran d'introduction", () => {
    render(
      <Qcm
        quiz={{ ...QUIZ_CHAPITRE, best_score: 80, attempts_used: 1, attempts_remaining: 2 }}
        retourHref="/app"
        retourLibelle="Retour"
      />,
    );

    expect(screen.getByText(/Ton meilleur score : 80 %/)).toBeTruthy();
  });

  it("une question sans bonne réponse en base n'affiche pas « undefined »", async () => {
    /* Le serveur tolère une question dont aucun choix n'est marqué correct (défaut de
       saisie côté back-office) et la compte fausse. L'écran de résultat doit alors
       afficher un tiret, pas un trou. */
    brancherFetch({
      soumission: reponseJson({
        ...RESULTAT_ECHOUE,
        questions: [
          {
            ...RESULTAT_ECHOUE.questions[0]!,
            choices: RESULTAT_ECHOUE.questions[0]!.choices.map((c) => ({
              ...c,
              is_correct: false,
              chosen: false,
            })),
          },
        ],
      }),
    });
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => screen.getByText(/Score : 50 %/));

    expect(screen.getByText("Bonne réponse : —")).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it("une explication contenant du HTML est affichée comme du texte, jamais interprétée", async () => {
    const charge = "<img src=x onerror=alert(1)>";
    brancherFetch({
      soumission: reponseJson({
        ...RESULTAT_ECHOUE,
        questions: [
          { ...RESULTAT_ECHOUE.questions[0]!, explanation: charge },
          RESULTAT_ECHOUE.questions[1]!,
        ],
      }),
    });
    const utilisateur = userEvent.setup();
    const { container } = render(
      <Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />,
    );

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => screen.getByText(/Score : 50 %/));

    expect(screen.getByText(charge)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Qcm — navigation dans le questionnaire", () => {
  beforeEach(() => brancherFetch({}));

  it("le bouton Précédent revient à la question précédente sans perdre la réponse", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Précédent" }));

    await waitFor(() => screen.getByText("Question 1/2"));
    expect(
      (screen.getByLabelText("Vérifie l'installation") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("la première question ne propose pas de Précédent", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/2"));

    expect(screen.queryByRole("button", { name: "Précédent" })).toBeNull();
  });

  it("changer d'avis sur une question remplace la réponse au lieu de l'ajouter", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/2"));
    await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
    await utilisateur.click(screen.getByLabelText("Publie l'application"));

    expect(
      (screen.getByLabelText("Vérifie l'installation") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText("Publie l'application") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("tout le questionnaire se parcourt au clavier, sans piège de focus", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    // Intro : le bouton puis le lien de retour sont atteignables à la tabulation.
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Commencer" }));
    await utilisateur.keyboard("{Enter}");
    await waitFor(() => screen.getByText("Question 1/2"));

    // Le groupe de boutons radio se prend au clavier et se choisit aux flèches.
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Vérifie l'installation"));
    await utilisateur.keyboard("{ArrowDown}");
    expect(
      (screen.getByLabelText("Publie l'application") as HTMLInputElement).checked,
    ).toBe(true);

    // Puis le bouton d'avancement, activable à la touche Entrée.
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Suivant" }));
    await utilisateur.keyboard("{Enter}");
    await waitFor(() => screen.getByText("Question 2/2"));
  });

  it("aucun élément interactif n'est retiré de l'ordre de tabulation", async () => {
    const utilisateur = userEvent.setup();
    const { container } = render(
      <Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />,
    );

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/2"));

    const interactifs = container.querySelectorAll("button, a, input");
    expect(interactifs.length).toBeGreaterThan(0);
    for (const element of interactifs) {
      expect(element.getAttribute("tabindex")).toBeNull();
      expect(element.getAttribute("aria-hidden")).toBeNull();
    }
  });

  it("chaque question est un `fieldset` avec sa `legend` : le libellé suit le groupe", async () => {
    const utilisateur = userEvent.setup();
    const { container } = render(
      <Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />,
    );

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/2"));

    const groupe = container.querySelector("fieldset");
    expect(groupe).not.toBeNull();
    expect(groupe!.querySelector("legend")!.textContent).toBe(
      QUIZ_CHAPITRE.questions[0]!.text,
    );
    // Les deux choix d'une même question partagent un `name` : un seul est retenu.
    const noms = new Set(
      [...groupe!.querySelectorAll("input")].map((i) => i.getAttribute("name")),
    );
    expect(noms).toEqual(new Set(["question-10"]));
  });
});

describe("Qcm — récapitulatif d'examen", () => {
  beforeEach(() => brancherFetch({}));

  it("« Modifier » ramène à la question choisie sans effacer les autres réponses", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_EXAMEN} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Vérifier avant d'envoyer" }));
    await waitFor(() => screen.getByText(/Vérifie tes réponses/));

    await utilisateur.click(screen.getAllByRole("button", { name: "Modifier" })[1]!);

    await waitFor(() => screen.getByText("Question 2/2"));
    expect((screen.getByLabelText("Non") as HTMLInputElement).checked).toBe(true);
  });

  it("le récapitulatif liste toutes les questions avec la réponse retenue", async () => {
    /* Le composant prévoit une mention « Pas de réponse » (`Qcm.tsx:258`). Elle est
       aujourd'hui inatteignable : « Suivant » et « Vérifier avant d'envoyer » restent
       désactivés tant que la question affichée n'a pas de réponse, et rien ne permet
       de désélectionner un choix — donc le récapitulatif ne peut décrire que des
       questions déjà répondues. C'est cette invariante-là qu'on fixe ici ; la branche
       morte est signalée au rapport plutôt que couverte par un test artificiel. */
    const utilisateur = userEvent.setup();
    const quizTroisQuestions = {
      ...QUIZ_EXAMEN,
      questions: [
        ...QUIZ_EXAMEN.questions,
        {
          id: 12,
          order: 3,
          text: "Troisième question ?",
          choices: [{ id: 120, text: "Peut-être" }],
        },
      ],
    };
    render(<Qcm quiz={quizTroisQuestions} retourHref="/app" retourLibelle="Retour" />);

    await utilisateur.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => screen.getByText("Question 1/3"));
    await utilisateur.click(screen.getByLabelText("Vérifie l'installation"));
    await utilisateur.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => screen.getByText("Question 2/3"));
    await utilisateur.click(screen.getByLabelText("Non"));
    // Le bouton de fin reste désactivé tant que la troisième n'a pas de réponse.
    await utilisateur.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => screen.getByText("Question 3/3"));
    expect(
      (
        screen.getByRole("button", {
          name: "Vérifier avant d'envoyer",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await utilisateur.click(screen.getByLabelText("Peut-être"));
    await utilisateur.click(screen.getByRole("button", { name: "Vérifier avant d'envoyer" }));

    await waitFor(() => screen.getByText(/Vérifie tes réponses/));
    expect(screen.queryByText("Pas de réponse")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Modifier" })).toHaveLength(3);
  });

  it("l'examen n'envoie rien avant le récapitulatif", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_EXAMEN} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Vérifier avant d'envoyer" }));
    await waitFor(() => screen.getByText(/Vérifie tes réponses/));

    const appels = vi.mocked(fetch).mock.calls.map((appel) => String(appel[0]));
    expect(appels.filter((url) => url.includes("/submit"))).toHaveLength(0);
  });

  it("le corps envoyé ne contient que `answers` — jamais de score ni de verdict", async () => {
    const utilisateur = userEvent.setup();
    render(<Qcm quiz={QUIZ_CHAPITRE} retourHref="/app" retourLibelle="Retour" />);

    await repondreAuxDeuxQuestions(utilisateur);
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => screen.getByText(/Score : 50 %/));

    const appel = vi
      .mocked(fetch)
      .mock.calls.find((c) => String(c[0]).includes("/submit"))!;
    const corps: unknown = JSON.parse(String((appel[1] as RequestInit).body));
    expect(Object.keys(corps as Record<string, unknown>)).toEqual(["answers"]);
    expect((corps as { answers: Record<string, number> }).answers).toEqual({
      "10": 100,
      "11": 110,
    });
  });
});

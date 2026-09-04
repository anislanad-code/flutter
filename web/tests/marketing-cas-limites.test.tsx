// @vitest-environment jsdom
/* Cas limites des composants interactifs de l'étape 2 : états de chargement et
   d'erreur, navigation clavier, contenu hostile ou incomplet. Le rendu nominal est
   couvert par `composants-marketing.test.tsx` — ici on ne teste que ce qui frotte. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LecteurChapitre } from "@/components/course/LecteurChapitre";
import { Parcours } from "@/components/marketing/Parcours";
import { analyserTranscript } from "@/lib/markdown-leger";
import type { ChapitreGratuit, CoursPublic } from "@/lib/catalog-schemas";

afterEach(() => cleanup());

const CHAPITRE: ChapitreGratuit = {
  id: 1,
  slug: "installer-flutter",
  title: "Installer Flutter",
  is_free: true,
  lesson: {
    id: 1,
    duration_s: 480,
    transcript: "Un paragraphe.",
    resources: [],
  },
  module_title: "Mise en route",
  course_slug: "flutter-firebase-debutants",
  course_title: "Flutter + Firebase",
};

describe("FormulaireListeAttente — états et clavier", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  async function monter() {
    const { FormulaireListeAttente } = await import(
      "@/components/marketing/FormulaireListeAttente"
    );
    render(createElement(FormulaireListeAttente));
  }

  function reponse(status: number): Response {
    return new Response(JSON.stringify({ detail: "x" }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("dit quoi corriger quand Django refuse l'adresse (400)", async () => {
    fetchMock.mockResolvedValue(reponse(400));
    await monter();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pas-un-email" } });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Vérifie ton adresse email/),
    );
    // Le formulaire reste rempli : on ne fait pas recommencer la saisie (§6).
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("pas-un-email");
  });

  it("affiche l'état de chargement et désactive le bouton pendant l'envoi", async () => {
    let resoudre: (valeur: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resoudre = resolve;
      }),
    );
    await monter();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));

    const bouton = await screen.findByRole("button", { name: "Envoi…" });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);

    resoudre(reponse(201));
    await waitFor(() => expect(screen.getByText(/Inscrit·e à la liste/)).toBeTruthy());
  });

  it("efface le message d'erreur précédent à la nouvelle tentative", async () => {
    fetchMock.mockResolvedValueOnce(reponse(429)).mockResolvedValueOnce(reponse(201));
    await monter();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));

    await waitFor(() => expect(screen.getByText(/Inscrit·e à la liste/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("se soumet à la touche Entrée depuis le champ email", async () => {
    fetchMock.mockResolvedValue(reponse(201));
    await monter();

    const champ = screen.getByLabelText("Email");
    fireEvent.change(champ, { target: { value: "a@example.com" } });
    fireEvent.submit(champ.closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("expose chaque champ visible à un lecteur d'écran et au clavier", async () => {
    await monter();

    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const telephone = screen.getByLabelText(/Téléphone/) as HTMLInputElement;
    const bouton = screen.getByRole("button", { name: /liste d'attente/i });

    // Aucun tabIndex positif ni négatif sur les éléments utiles : l'ordre du DOM
    // suffit, et rien d'utile n'est retiré du parcours clavier (§6, plancher a11y).
    for (const element of [email, telephone, bouton]) {
      expect(element.getAttribute("tabindex")).toBeNull();
    }
    expect(email.type).toBe("email");
    expect(telephone.type).toBe("tel");
  });

  it("fige l'horodatage de rendu au montage, sans le rejouer entre deux envois", async () => {
    fetchMock.mockResolvedValue(reponse(400));
    await monter();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const horodatages = fetchMock.mock.calls.map(
      (appel) => JSON.parse(String((appel[1] as RequestInit).body)).form_rendered_at,
    );
    expect(horodatages[0]).toBe(horodatages[1]);
  });

  it("transmet le honeypot rempli tel quel : c'est le serveur qui tranche", async () => {
    fetchMock.mockResolvedValue(reponse(201));
    await monter();

    const honeypot = document.querySelector('input[name="site"]') as HTMLInputElement;
    fireEvent.change(honeypot, { target: { value: "http://spam.example" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bot@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corps = JSON.parse(String(init.body));
    expect(corps.site).toBe("http://spam.example");
    // Et l'écran affiche le même succès qu'une vraie inscription : aucun signal au bot.
    await waitFor(() => expect(screen.getByText(/Inscrit·e à la liste/)).toBeTruthy());
  });
});

describe("LecteurChapitre — contenu hostile ou incomplet", () => {
  it("échappe le HTML d'un transcript au lieu de l'injecter (§8.8, XSS stocké)", () => {
    const hostile: ChapitreGratuit = {
      ...CHAPITRE,
      lesson: {
        ...CHAPITRE.lesson,
        transcript: "<img src=x onerror=alert(1)>\n\n## <script>alert(2)</script>",
        resources: [{ titre: "<b>lien</b>", url: "https://exemple.test" }],
      },
    };

    const html = renderToStaticMarkup(createElement(LecteurChapitre, { chapitre: hostile }));

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).toContain("&lt;img");
  });

  it("ne rend aucun bloc quand le transcript est vide", () => {
    const vide: ChapitreGratuit = {
      ...CHAPITRE,
      lesson: { ...CHAPITRE.lesson, transcript: "" },
    };

    const html = renderToStaticMarkup(createElement(LecteurChapitre, { chapitre: vide }));

    // Le conteneur des blocs du transcript reste vide (le reste, c'est le lecteur).
    expect(html).toContain('<div class="flex flex-col gap-4"></div>');
    expect(html).not.toContain("<video");
  });

  it("n'embarque aucune URL de fichier vidéo dans le HTML du SSR", () => {
    const html = renderToStaticMarkup(createElement(LecteurChapitre, { chapitre: CHAPITRE }));

    expect(html).not.toContain("<video");
    expect(html).not.toMatch(/\.(mp4|m3u8|webm|mkv)\b/i);
    expect(html).not.toContain("b-cdn.net");
    expect(html).toContain("Chargement de la vidéo");
  });

  it("ne fabrique jamais d'URL de fichier à partir de l'identifiant de leçon", () => {
    /* §4.1.1 — le composant ne dérive aucune source. La lecture passe par
       `POST /api/lessons/{id}/playback` après hydratation. */
    const html = renderToStaticMarkup(createElement(LecteurChapitre, { chapitre: CHAPITRE }));

    expect(html).not.toMatch(/\.(mp4|m3u8|webm|mkv)\b/i);
    expect(html).not.toContain("/videos/");
    expect(html).not.toContain("bcdn_token");
  });
});

describe("Parcours — cas limites de structure", () => {
  const cours = (modules: CoursPublic["modules"]): CoursPublic => ({
    slug: "s",
    title: "T",
    description: "D",
    modules,
  });

  it("affiche un module sans résumé et sans chapitre sans planter", () => {
    render(
      createElement(Parcours, {
        cours: cours([{ id: 1, order: 0, title: "Module vide", summary: "", chapters: [] }]),
      }),
    );

    expect(screen.getByText(/Module vide/)).toBeTruthy();
  });

  it("rend un parcours vide quand la formation n'a aucun module", () => {
    const { container } = render(createElement(Parcours, { cours: cours([]) }));
    expect(container.querySelectorAll("li").length).toBe(0);
  });

  it("dévalorise le chapitre payant sans le rendre inatteignable visuellement (§6)", () => {
    render(
      createElement(Parcours, {
        cours: cours([
          {
            id: 1,
            order: 0,
            title: "M",
            summary: "",
            chapters: [
              { id: 1, slug: "libre", order: 1, title: "Libre", is_free: true },
              { id: 2, slug: "payant", order: 2, title: "Payant", is_free: false },
            ],
          },
        ]),
      }),
    );

    const payant = screen.getByText("Payant");
    expect(payant.closest("li")!.className).toContain("opacity-45");
    expect(payant.getAttribute("title")).toBe("Réservé aux inscrits actifs");
    // Aucun cadenas, aucun message de blocage : le §2 interdit le gating dur.
    expect(screen.queryByText(/verrouillé|cadenas/i)).toBeNull();
  });

  it("respecte l'ordre des modules renvoyé par le serveur, sans retrier", () => {
    render(
      createElement(Parcours, {
        cours: cours([
          { id: 2, order: 1, title: "Deuxième", summary: "", chapters: [] },
          { id: 1, order: 0, title: "Premier", summary: "", chapters: [] },
        ]),
      }),
    );

    const titres = screen.getAllByRole("heading", { level: 3 }).map((n) => n.textContent);
    expect(titres[0]).toContain("Deuxième");
  });
});

describe("analyserTranscript — cas limites du contenu de back-office", () => {
  it("laisse un titre de niveau 3 en paragraphe (le parseur ne gère que ##)", () => {
    expect(analyserTranscript("### Sous-titre")).toEqual([
      { type: "paragraphe", texte: "### Sous-titre" },
    ]);
  });

  it("ignore l'étiquette de langage d'un bloc de code", () => {
    expect(analyserTranscript("```dart\nvoid main() {}\n```")).toEqual([
      { type: "code", texte: "void main() {}" },
    ]);
  });

  it("préserve l'indentation à l'intérieur d'un bloc de code", () => {
    expect(analyserTranscript("```\n  indenté\n```")).toEqual([
      { type: "code", texte: "  indenté" },
    ]);
  });

  it("perd le contenu d'un bloc de code jamais refermé (limite connue du parseur)", () => {
    /* Un `\`\`\`` ouvert et jamais refermé dans le back-office fait disparaître la fin
       du chapitre en silence. Sans conséquence de sécurité, mais à corriger quand la
       saisie de contenu passera par l'admin (étape 7). */
    expect(analyserTranscript("Avant.\n\n```\nflutter doctor")).toEqual([
      { type: "paragraphe", texte: "Avant." },
    ]);
  });
});

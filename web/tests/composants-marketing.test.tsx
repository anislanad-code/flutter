// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Faq } from "@/components/marketing/Faq";
import { LecteurChapitreGratuit } from "@/components/marketing/LecteurChapitreGratuit";
import { LecteurVideo } from "@/components/marketing/LecteurVideo";
import { Parcours } from "@/components/marketing/Parcours";
import { Tarifs } from "@/components/marketing/Tarifs";
import type { ChapitreGratuit, CoursPublic } from "@/lib/catalog-schemas";

afterEach(() => cleanup());

const CHAPITRE: ChapitreGratuit = {
  id: 1,
  slug: "installer-flutter",
  title: "Installer Flutter",
  is_free: true,
  lesson: {
    video_provider_id: "",
    duration_s: 10,
    transcript: "Un paragraphe.\n\n## Un titre\n\nUn autre paragraphe.\n\n```\nflutter doctor\n```",
    resources: [{ titre: "flutter.dev", url: "https://flutter.dev" }],
  },
  module_title: "Mise en route",
  course_slug: "flutter-firebase-debutants",
  course_title: "Flutter + Firebase",
};

const COURS: CoursPublic = {
  slug: "flutter-firebase-debutants",
  title: "Flutter + Firebase",
  description: "Une vraie application.",
  modules: [
    {
      id: 1,
      order: 0,
      title: "Mise en route",
      summary: "Installer l'outillage.",
      chapters: [
        { id: 1, slug: "installer-flutter", order: 1, title: "Installer Flutter", is_free: true },
        { id: 2, slug: "premier-widget", order: 2, title: "Premier widget", is_free: false },
      ],
    },
  ],
};

describe("LecteurVideo", () => {
  it("affiche un état d'attente honnête quand il n'y a pas de source", () => {
    render(createElement(LecteurVideo, { src: null, titre: "Installer Flutter" }));
    expect(screen.getByLabelText(/Vidéo de « Installer Flutter » à venir/)).toBeTruthy();
    expect(document.querySelector("video")).toBeNull();
  });

  it("rend une balise vidéo avec le téléchargement désactivé quand une source existe", () => {
    render(createElement(LecteurVideo, { src: "/videos/x.mp4", titre: "Installer Flutter" }));
    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("controlslist")).toBe("nodownload");
  });

  it("neutralise le clic droit", () => {
    render(createElement(LecteurVideo, { src: "/videos/x.mp4", titre: "T" }));
    const video = document.querySelector("video")!;
    const evenement = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    video.dispatchEvent(evenement);
    expect(evenement.defaultPrevented).toBe(true);
  });
});

describe("LecteurChapitreGratuit", () => {
  it("rend le transcript en titres, paragraphes et code, et les ressources", () => {
    const html = renderToStaticMarkup(createElement(LecteurChapitreGratuit, { chapitre: CHAPITRE }));

    expect(html).toContain("Un titre");
    expect(html).toContain("Un paragraphe.");
    expect(html).toContain("flutter doctor");
    expect(html).toContain("flutter.dev");
  });

  it("n'affiche pas de section ressources quand il n'y en a aucune", () => {
    const sansRessources = { ...CHAPITRE, lesson: { ...CHAPITRE.lesson, resources: [] } };
    const html = renderToStaticMarkup(
      createElement(LecteurChapitreGratuit, { chapitre: sansRessources }),
    );

    expect(html).not.toContain("Ressources");
  });
});

describe("Parcours", () => {
  it("propose un lien vers le chapitre gratuit et grise le reste sans lien mort", () => {
    render(createElement(Parcours, { cours: COURS }));

    const lienGratuit = screen.getByRole("link", { name: /Installer Flutter/ });
    expect(lienGratuit.getAttribute("href")).toBe("/gratuit/installer-flutter");

    // Le chapitre payant n'est pas un lien (pas de gating dur, mais pas de fausse
    // promesse non plus tant que l'espace étudiant n'existe pas encore).
    expect(screen.queryByRole("link", { name: /Premier widget/ })).toBeNull();
    expect(screen.getByText("Premier widget")).toBeTruthy();
  });
});

describe("Tarifs", () => {
  it("affiche un prix unique et le formulaire de liste d'attente", () => {
    render(createElement(Tarifs));
    expect(screen.getByText(/15 000 DA|15 000 DA/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /liste d'attente/i })).toBeTruthy();
  });
});

describe("Faq", () => {
  it("rend au moins cinq questions avec leur réponse", () => {
    render(createElement(Faq));
    expect(screen.getAllByRole("term").length).toBeGreaterThanOrEqual(5);
  });
});

describe("FormulaireListeAttente", () => {
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

  function reponse(status: number, corps: unknown = { detail: "ok" }): Response {
    return new Response(JSON.stringify(corps), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("envoie l'email, le honeypot vide et l'horodatage, puis affiche le message de succès", async () => {
    fetchMock.mockResolvedValue(reponse(201));
    await monter();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "visiteuse@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));

    await waitFor(() => expect(screen.getByText(/Inscrit·e à la liste/)).toBeTruthy());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corps = JSON.parse(String(init.body));
    expect(corps.email).toBe("visiteuse@example.com");
    expect(corps.site).toBe("");
    expect(typeof corps.form_rendered_at).toBe("number");
  });

  it("affiche un message dédié sur 429", async () => {
    fetchMock.mockResolvedValue(reponse(429));
    await monter();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Trop de tentatives/));
  });

  it("affiche une erreur générique sur échec réseau", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    await monter();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /liste d'attente/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/connexion a échoué/));
  });

  it("garde le champ honeypot invisible et hors du focus clavier", async () => {
    await monter();
    const honeypot = document.querySelector('input[name="site"]') as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.getAttribute("aria-hidden")).toBe("true");
  });
});

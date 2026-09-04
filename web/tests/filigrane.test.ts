// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  filigraneEstVisible,
  libelleFiligraneHorodate,
  OPACITE_MINIMALE,
} from "@/lib/filigrane";

describe("libelleFiligraneHorodate", () => {
  it("ajoute l'heure à deux chiffres", () => {
    const date = new Date(2026, 8, 4, 9, 5, 0);
    expect(libelleFiligraneHorodate("etudiante · 2233", date)).toBe("etudiante · 2233 · 09:05");
  });
});

describe("filigraneEstVisible", () => {
  function noeuds(): { conteneur: HTMLElement; noeud: HTMLElement } {
    const conteneur = document.createElement("div");
    const noeud = document.createElement("div");
    noeud.textContent = "etudiante · 2233 · 09:05";
    conteneur.appendChild(noeud);
    document.body.appendChild(conteneur);
    Object.defineProperty(noeud, "offsetWidth", { value: 80, configurable: true });
    Object.defineProperty(noeud, "offsetHeight", { value: 16, configurable: true });
    noeud.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 90, bottom: 26, width: 80, height: 16 }) as DOMRect;
    conteneur.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }) as DOMRect;
    return { conteneur, noeud };
  }

  function style(partiel: Record<string, string>): CSSStyleDeclaration {
    return {
      display: "block",
      visibility: "visible",
      opacity: String(OPACITE_MINIMALE + 0.02),
      fontSize: "14px",
      color: "rgb(250, 250, 247)",
      clipPath: "none",
      clip: "auto",
      filter: "none",
      zIndex: "10",
      ...partiel,
    } as unknown as CSSStyleDeclaration;
  }

  it("accepte un filigrane aux styles nominaux", () => {
    const { conteneur, noeud } = noeuds();
    vi.spyOn(window, "getComputedStyle").mockReturnValue(style({}));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(true);
  });

  it("refuse display none, opacity trop basse, nœud retiré", () => {
    const { conteneur, noeud } = noeuds();
    const spy = vi.spyOn(window, "getComputedStyle");

    spy.mockReturnValue(style({ display: "none" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ opacity: "0" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({}));
    conteneur.removeChild(noeud);
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);
  });

  it("refuse visibilité, police, couleur, clip et filtre hostiles", () => {
    const { conteneur, noeud } = noeuds();
    const spy = vi.spyOn(window, "getComputedStyle");

    spy.mockReturnValue(style({ visibility: "hidden" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ fontSize: "4px" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ color: "transparent" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ clipPath: "inset(100%)" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ filter: "opacity(0)" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);
  });

  it("refuse un nœud hors du cadre du lecteur", () => {
    const { conteneur, noeud } = noeuds();
    vi.spyOn(window, "getComputedStyle").mockReturnValue(style({}));
    noeud.getBoundingClientRect = () =>
      ({ left: 400, top: 400, right: 480, bottom: 416, width: 80, height: 16 }) as DOMRect;
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);
  });

  it("refuse collapse, rgba transparent, taille nulle, clip rect et brightness 0", () => {
    const { conteneur, noeud } = noeuds();
    const spy = vi.spyOn(window, "getComputedStyle");

    spy.mockReturnValue(style({ visibility: "collapse" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ color: "rgba(0, 0, 0, 0)" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ filter: "brightness(0)" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ clip: "rect(0px, 0px, 0px, 0px)" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({}));
    Object.defineProperty(noeud, "offsetWidth", { value: 2, configurable: true });
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);
  });

  it("refuse une opacite ou une police non numeriques", () => {
    const { conteneur, noeud } = noeuds();
    const spy = vi.spyOn(window, "getComputedStyle");

    spy.mockReturnValue(style({ opacity: "auto" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ fontSize: "xx-large" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);
  });

  it("refuse un texte vidé, un z-index sous la vidéo, un scale à zéro et une couleur collée au fond", () => {
    const { conteneur, noeud } = noeuds();
    const spy = vi.spyOn(window, "getComputedStyle");

    spy.mockReturnValue(style({}));
    noeud.textContent = "   ";
    expect(filigraneEstVisible(noeud, conteneur, "etudiante · 2233")).toBe(false);

    noeud.textContent = "visiteur · 09:05";
    expect(filigraneEstVisible(noeud, conteneur, "etudiante · 2233")).toBe(false);

    noeud.textContent = "etudiante · 2233 · 09:05";
    spy.mockReturnValue(style({ zIndex: "-1" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({ color: "rgb(20, 32, 30)" }));
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);

    spy.mockReturnValue(style({}));
    noeud.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 10, bottom: 10, width: 0, height: 0 }) as DOMRect;
    expect(filigraneEstVisible(noeud, conteneur)).toBe(false);
  });
});

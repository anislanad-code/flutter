import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ECHELLE, PALETTE } from "@/lib/design-tokens";

/* La page de référence décrit les jetons ; `styles/tokens.css` les définit.
   Ces tests existent pour qu'elle ne puisse pas mentir : toute divergence casse ici. */

const css = readFileSync(path.resolve(__dirname, "../styles/tokens.css"), "utf8");

function declaration(jeton: string): string {
  const trouve = new RegExp(`${jeton}:\\s*([^;]+);`).exec(css);
  if (!trouve?.[1]) throw new Error(`Le jeton ${jeton} n'existe pas dans tokens.css`);
  return trouve[1].trim();
}

describe("les jetons décrits correspondent aux jetons définis", () => {
  it.each(PALETTE.map((c) => [c.jeton, c.valeur] as const))(
    "%s vaut %s dans tokens.css",
    (jeton, valeur) => {
      expect(declaration(jeton).toLowerCase()).toBe(valeur.toLowerCase());
    },
  );

  it.each(ECHELLE.map((n) => [n.jeton, n.valeur] as const))(
    "%s vaut %s dans tokens.css",
    (jeton, valeur) => {
      expect(declaration(jeton).replace(/\s+/g, " ")).toBe(valeur.replace(/\s+/g, " "));
    },
  );
});

describe("la palette du §6 est close", () => {
  it("ne déclare que les six couleurs autorisées", () => {
    const couleurs = [...css.matchAll(/^\s*(--[a-z]+):\s*#[0-9a-f]{6};/gim)].map((m) => m[1]);

    expect(new Set(couleurs)).toEqual(new Set(PALETTE.map((c) => c.jeton)));
  });

  it("aucun composant ne code une couleur en dur", () => {
    const sources = [
      "app/(marketing)/page.tsx",
      "app/layout.tsx",
      "app/globals.css",
      "tailwind.config.ts",
    ];

    for (const fichier of sources) {
      const contenu = readFileSync(path.resolve(__dirname, "..", fichier), "utf8");
      expect(contenu, `${fichier} contient une couleur hexadécimale`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
    }
  });
});

describe("la favicon", () => {
  it("n'emploie que des couleurs de la palette", () => {
    /* Une favicon est servie hors du document : elle ne peut pas lire les variables
       CSS et doit donc porter ses couleurs en dur. C'est la seule exception au §7,
       et ce test l'empêche de dériver. */
    const svg = readFileSync(path.resolve(__dirname, "../app/icon.svg"), "utf8");
    const couleurs = [...svg.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase());
    const autorisees = PALETTE.map((c) => c.valeur.toLowerCase());

    expect(couleurs.length).toBeGreaterThan(0);
    for (const couleur of couleurs) {
      expect(autorisees).toContain(couleur);
    }
  });
});

describe("le corps de texte respecte son plancher", () => {
  it("ne descend jamais sous 16 px", () => {
    const base = ECHELLE.find((n) => n.jeton === "--texte-base");

    expect(base?.valeur).toBe("1rem");
  });

  it("rend fluides les trois plus gros niveaux, pour tenir à 360 px", () => {
    for (const jeton of ["--texte-3xl", "--texte-4xl", "--texte-5xl"]) {
      expect(declaration(jeton)).toMatch(/^clamp\(/);
    }
  });
});

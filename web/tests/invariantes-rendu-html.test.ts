import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/* Invariante de rendu, à rejouer à chaque étape (§4.4, §8 point 8).

   L'étape 6 introduit trois champs de texte libre édités depuis le back-office —
   `Question.text`, `Choice.text`, `Question.explanation` — qui sont réaffichés à
   l'étudiant après correction. Le plan de l'étape l'exige explicitement : « le rendu
   des explications passe par un assainissement strict (pas de
   `dangerouslySetInnerHTML` sur du contenu non nettoyé) ». Le seul assainissement
   réellement strict, ici, c'est de ne jamais fabriquer de HTML : React échappe tout ce
   qui passe par un nœud texte.

   Ce test balaie donc l'ensemble de `app/`, `components/` et `lib/` et n'autorise
   `dangerouslySetInnerHTML` qu'à un seul endroit, connu et justifié : le bloc JSON-LD
   de la landing, qui n'est pas du HTML et échappe `<`. */

const RACINE = path.resolve(__dirname, "..");
const DOSSIERS = ["app", "components", "lib"];
const AUTORISES = new Set([path.join("app", "(marketing)", "page.tsx")]);

function fichiersSources(dossier: string): string[] {
  const complet = path.join(RACINE, dossier);
  const trouves: string[] = [];
  for (const entree of readdirSync(complet)) {
    const chemin = path.join(complet, entree);
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersSources(path.join(dossier, entree)));
    } else if (/\.(ts|tsx)$/.test(entree)) {
      trouves.push(path.join(dossier, entree));
    }
  }
  return trouves;
}

const SOURCES = DOSSIERS.flatMap(fichiersSources);

describe("invariante — aucun HTML fabriqué à partir de contenu de la base", () => {
  it("le balayage voit bien les fichiers de l'étape 6", () => {
    expect(SOURCES).toContain(path.join("components", "assessment", "Qcm.tsx"));
    expect(SOURCES).toContain(path.join("app", "(student)", "app", "qcm", "[id]", "page.tsx"));
  });

  it("`dangerouslySetInnerHTML` n'apparaît que dans le bloc JSON-LD de la landing", () => {
    const coupables = SOURCES.filter(
      (fichier) =>
        !AUTORISES.has(fichier) &&
        // L'attribut réellement posé sur un nœud, pas une mention en commentaire
        // (`lib/markdown-leger.ts` documente justement qu'il ne s'en sert pas).
        /dangerouslySetInnerHTML\s*=\s*\{/.test(
          readFileSync(path.join(RACINE, fichier), "utf8"),
        ),
    );

    expect(coupables).toEqual([]);
  });

  it("le seul usage autorisé échappe encore `<` avant de sortir", () => {
    const source = readFileSync(
      path.join(RACINE, "app", "(marketing)", "page.tsx"),
      "utf8",
    );

    expect(source).toContain("\\\\u003c");
    expect(source).toContain('type="application/ld+json"');
  });

  it("l'écran de QCM n'utilise ni `innerHTML`, ni `document.write`, ni `eval`", () => {
    const source = readFileSync(
      path.join(RACINE, "components", "assessment", "Qcm.tsx"),
      "utf8",
    );

    for (const interdit of ["innerHTML", "document.write", "eval(", "new Function"]) {
      expect(source).not.toContain(interdit);
    }
  });
});

describe("invariante — aucun stockage navigateur pour l'authentification (§4.2)", () => {
  it("ni `localStorage` ni `sessionStorage` dans les sources du client", () => {
    const coupables = SOURCES.filter((fichier) => {
      const source = readFileSync(path.join(RACINE, fichier), "utf8");
      return source.includes("localStorage") || source.includes("sessionStorage");
    });

    expect(coupables).toEqual([]);
  });
});

describe("invariante — le client ne parle jamais directement à Django (§3)", () => {
  it("aucun composant client ne construit d'URL vers l'API interne", () => {
    const coupables = SOURCES.filter((fichier) => {
      if (fichier.startsWith("lib") || fichier.startsWith(path.join("app", "api"))) {
        return false;
      }
      const source = readFileSync(path.join(RACINE, fichier), "utf8");
      return source.includes("API_INTERNAL_URL") || source.includes(":8000");
    });

    expect(coupables).toEqual([]);
  });
});

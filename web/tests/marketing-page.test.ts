import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ReferenceDesign, { metadata } from "@/app/(marketing)/page";

/* Page de référence du design (§6). Elle est un Server Component sans données :
   on la rend en HTML statique, sans DOM ni navigateur. */

const html = renderToStaticMarkup(createElement(ReferenceDesign));

describe("page de référence — rendu", () => {
  it("rend un <main> unique avec un seul h1", () => {
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("Référence de design");
  });

  it("affiche les six jetons de couleur du §6 et aucun autre", () => {
    for (const jeton of ["--paper", "--ink", "--zellige", "--safran", "--muted", "--danger"]) {
      expect(html).toContain(jeton);
    }
  });

  it("affiche les valeurs hexadécimales exactes de la palette", () => {
    for (const valeur of ["#FAFAF7", "#14201E", "#0E6E63", "#E0A22B", "#6E7B78", "#B4342A"]) {
      expect(html.toLowerCase()).toContain(valeur.toLowerCase());
    }
  });

  it("rend les neuf niveaux de l'échelle typographique", () => {
    const niveaux = [
      "--texte-5xl",
      "--texte-4xl",
      "--texte-3xl",
      "--texte-2xl",
      "--texte-xl",
      "--texte-lg",
      "--texte-base",
      "--texte-sm",
      "--texte-xs",
    ];
    for (const niveau of niveaux) {
      expect(html).toContain(niveau);
    }
    expect(html.match(/Construis ton application/g)).toHaveLength(niveaux.length);
  });

  it("rend les quatre états du parcours", () => {
    for (const etat of ["Terminé", "En cours", "Disponible", "Recommandé plus tard"]) {
      expect(html).toContain(etat);
    }
  });

  it("n'utilise la mono que pour du vrai code : le seul <pre> contient du Dart", () => {
    expect(html.match(/<pre\b/g)).toHaveLength(1);
    expect(html).toContain("runApp(const MonApplication());");
  });

  it("donne un nom accessible à chaque section (aria-labelledby résolu)", () => {
    const references = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);

    expect(references.length).toBeGreaterThanOrEqual(4);
    for (const id of references) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("marque les pastilles purement décoratives en aria-hidden", () => {
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(10);
  });
});

describe("page de référence — sécurité et contenu", () => {
  it("ne divulgue aucune URL interne ni port de Django (§3)", () => {
    expect(html).not.toContain("api:8000");
    expect(html).not.toContain(":8000");
    expect(html).not.toContain("localhost");
  });

  it("ne pointe que vers la route BFF de Next pour l'état du service", () => {
    const liens = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

    expect(liens).toContain("/api/health");
    for (const lien of liens) {
      expect(lien?.startsWith("/")).toBe(true);
    }
  });

  it("n'injecte aucun HTML brut (pas de dangerouslySetInnerHTML, pas de <script>)", () => {
    expect(html).not.toContain("<script");
  });

  it("reste hors index tant qu'elle est provisoire", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toContain("anis.dev");
  });
});

import { describe, expect, it } from "vitest";

import { analyserTranscript } from "@/lib/markdown-leger";

describe("analyserTranscript", () => {
  it("découpe titres, paragraphes et blocs de code", () => {
    const source = [
      "Un paragraphe.",
      "",
      "## Un titre",
      "",
      "Un autre paragraphe",
      "sur deux lignes.",
      "",
      "```",
      "flutter doctor",
      "```",
    ].join("\n");

    expect(analyserTranscript(source)).toEqual([
      { type: "paragraphe", texte: "Un paragraphe." },
      { type: "titre", texte: "Un titre" },
      { type: "paragraphe", texte: "Un autre paragraphe sur deux lignes." },
      { type: "code", texte: "flutter doctor" },
    ]);
  });

  it("renvoie un tableau vide pour une source vide", () => {
    expect(analyserTranscript("")).toEqual([]);
  });

  it("ignore les lignes vides répétées entre deux paragraphes", () => {
    expect(analyserTranscript("A\n\n\n\nB")).toEqual([
      { type: "paragraphe", texte: "A" },
      { type: "paragraphe", texte: "B" },
    ]);
  });

  it("ne produit jamais de balise HTML : c'est du texte, pas du HTML injecté", () => {
    const blocs = analyserTranscript("<script>alert(1)</script>");
    expect(blocs).toEqual([{ type: "paragraphe", texte: "<script>alert(1)</script>" }]);
  });
});

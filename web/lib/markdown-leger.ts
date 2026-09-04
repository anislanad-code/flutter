/* Parseur minimal pour le texte des transcripts (titres ##, blocs de code ``` , et
   paragraphes). Volontairement pas de librairie markdown complète : le contenu vient
   de notre propre seed / back-office, pas de saisie libre à grande échelle, et un
   rendu en éléments React (jamais `dangerouslySetInnerHTML`) élimine tout risque XSS
   par construction (§4.4, §7 — pas de confiance aveugle dans la forme des données). */

export type BlocTranscript =
  | { type: "titre"; texte: string }
  | { type: "code"; texte: string }
  | { type: "paragraphe"; texte: string };

export function analyserTranscript(source: string): BlocTranscript[] {
  const lignes = source.split("\n");
  const blocs: BlocTranscript[] = [];
  let tampon: string[] = [];
  let dansCode = false;
  let codeTampon: string[] = [];

  function vider(): void {
    const texte = tampon.join(" ").trim();
    if (texte) blocs.push({ type: "paragraphe", texte });
    tampon = [];
  }

  for (const ligne of lignes) {
    if (ligne.trim().startsWith("```")) {
      if (dansCode) {
        blocs.push({ type: "code", texte: codeTampon.join("\n") });
        codeTampon = [];
      } else {
        vider();
      }
      dansCode = !dansCode;
      continue;
    }
    if (dansCode) {
      codeTampon.push(ligne);
      continue;
    }
    if (ligne.startsWith("## ")) {
      vider();
      blocs.push({ type: "titre", texte: ligne.slice(3).trim() });
      continue;
    }
    if (ligne.trim() === "") {
      vider();
      continue;
    }
    tampon.push(ligne.trim());
  }
  vider();

  return blocs;
}

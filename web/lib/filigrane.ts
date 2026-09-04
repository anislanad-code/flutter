/* Filigrane dynamique (§4.1.4) et détection de neutralisation.

   `style-src 'unsafe-inline'` (nécessaire à Next/Tailwind) permettrait de masquer
   le filigrane sans toucher au DOM. On ne se fie donc pas au MutationObserver
   seul : on lit le style *calculé*, le texte, et l'intersection avec le lecteur. */

export const OPACITE_FILIGRANE = 0.15;
export const OPACITE_MINIMALE = 0.12;
export const INTERVALLE_ANCRAGE_MS = 20_000;

export const ANCRAGES = ["tl", "tr", "bl", "br", "tc", "bc"] as const;
export type Ancrage = (typeof ANCRAGES)[number];

export const CLASSES_ANCRAGE: Record<Ancrage, string> = {
  tl: "top-3 left-3",
  tr: "top-3 right-3",
  bl: "bottom-3 left-3",
  br: "bottom-3 right-3",
  tc: "top-3 left-1/2 -translate-x-1/2",
  bc: "bottom-3 left-1/2 -translate-x-1/2",
};

function couleurTropProcheDuFond(color: string): boolean {
  const compose = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!compose) return color === "transparent";
  const rouge = Number(compose[1]);
  const vert = Number(compose[2]);
  const bleu = Number(compose[3]);
  // Fond du lecteur : ink #14201E. Un texte collé à cette teinte disparaît.
  const dr = rouge - 0x14;
  const dg = vert - 0x20;
  const db = bleu - 0x1e;
  return dr * dr + dg * dg + db * db < 40 * 40;
}

export function filigraneEstVisible(
  noeud: HTMLElement,
  conteneur: HTMLElement,
  attendu?: string,
): boolean {
  if (!conteneur.contains(noeud)) return false;

  const texte = (noeud.textContent ?? "").replace(/\s+/g, " ").trim();
  if (texte.length < 8) return false;
  if (attendu && !texte.includes(attendu)) return false;

  const style = getComputedStyle(noeud);
  if (style.display === "none") return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") return false;

  const opacite = Number(style.opacity);
  if (!Number.isFinite(opacite) || opacite < OPACITE_MINIMALE) return false;

  const taillePolice = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(taillePolice) || taillePolice < 8) return false;

  if (style.color === "transparent" || style.color === "rgba(0, 0, 0, 0)") return false;
  if (couleurTropProcheDuFond(style.color)) return false;
  if (noeud.offsetWidth < 4 || noeud.offsetHeight < 4) return false;

  const z = Number.parseInt(style.zIndex, 10);
  if (Number.isFinite(z) && z < 1) return false;

  const clip = `${style.clipPath} ${style.clip}`;
  if (clip.includes("inset(100%") || clip.includes("rect(0px, 0px, 0px, 0px)")) return false;

  if (/\bopacity\(\s*0/.test(style.filter) || /\bbrightness\(\s*0/.test(style.filter)) {
    return false;
  }

  const boite = noeud.getBoundingClientRect();
  if (boite.width < 4 || boite.height < 4) return false;

  const cadre = conteneur.getBoundingClientRect();
  const seChevauchent = !(
    boite.right < cadre.left ||
    boite.left > cadre.right ||
    boite.bottom < cadre.top ||
    boite.top > cadre.bottom
  );
  return seChevauchent;
}

export function libelleFiligraneHorodate(label: string, maintenant: Date): string {
  const hh = String(maintenant.getHours()).padStart(2, "0");
  const mm = String(maintenant.getMinutes()).padStart(2, "0");
  return `${label} · ${hh}:${mm}`;
}

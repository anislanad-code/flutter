/* Description des jetons du §6, pour la page de référence du design.

   La source de vérité reste `styles/tokens.css` : ce module ne fait que la décrire,
   et `tests/design-tokens.test.ts` échoue dès que les deux divergent. C'est ce qui
   évite qu'une page de référence finisse par mentir sur ce qu'elle documente. */

export type JetonCouleur = {
  readonly jeton: string;
  readonly valeur: string;
  readonly usage: string;
  readonly classe: string;
  readonly contourne: boolean;
};

export const PALETTE: readonly JetonCouleur[] = [
  {
    jeton: "--paper",
    valeur: "#fafaf7",
    usage: "Fond. La seule surface de la page.",
    classe: "bg-paper",
    contourne: true,
  },
  {
    jeton: "--ink",
    valeur: "#14201e",
    usage: "Texte principal. Vert-noir, jamais un noir neutre.",
    classe: "bg-ink",
    contourne: false,
  },
  {
    jeton: "--zellige",
    valeur: "#0e6e63",
    usage: "Primaire : liens, boutons, état terminé.",
    classe: "bg-zellige",
    contourne: false,
  },
  {
    jeton: "--safran",
    valeur: "#e0a22b",
    usage: "Progression et étape courante. Jamais de la décoration.",
    classe: "bg-safran",
    contourne: false,
  },
  {
    jeton: "--muted",
    valeur: "#6e7b78",
    usage: "Texte secondaire, bordures.",
    classe: "bg-muted",
    contourne: false,
  },
  {
    jeton: "--danger",
    valeur: "#b4342a",
    usage: "Erreurs et actions destructives, rien d'autre.",
    classe: "bg-danger",
    contourne: false,
  },
] as const;

export type NiveauTypographique = {
  readonly jeton: string;
  readonly valeur: string;
  readonly role: string;
};

/* `valeur` reproduit la déclaration CSS telle quelle, `clamp()` compris : les trois
   plus gros niveaux sont fluides, parce qu'un titre de 4 rem déborde à 360 px. */
export const ECHELLE: readonly NiveauTypographique[] = [
  { jeton: "--texte-5xl", valeur: "clamp(2.5rem, 9vw, 4rem)", role: "Titre de héros" },
  { jeton: "--texte-4xl", valeur: "clamp(2rem, 7vw, 3rem)", role: "Titre de page" },
  { jeton: "--texte-3xl", valeur: "clamp(1.75rem, 5.5vw, 2.25rem)", role: "Titre de section" },
  { jeton: "--texte-2xl", valeur: "1.75rem", role: "Titre de bloc" },
  { jeton: "--texte-xl", valeur: "1.375rem", role: "Chapeau" },
  { jeton: "--texte-lg", valeur: "1.125rem", role: "Corps large" },
  { jeton: "--texte-base", valeur: "1rem", role: "Corps — plancher absolu" },
  { jeton: "--texte-sm", valeur: "0.9375rem", role: "Secondaire" },
  { jeton: "--texte-xs", valeur: "0.8125rem", role: "Métadonnée" },
] as const;

import type { Config } from "tailwindcss";

/* Les couleurs et les familles pointent vers les jetons de styles/tokens.css.
   Aucune valeur hexadécimale ne doit apparaître ailleurs (CLAUDE.md §6, §7). */
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        ink: "var(--ink)",
        zellige: "var(--zellige)",
        safran: "var(--safran)",
        muted: "var(--muted)",
        danger: "var(--danger)",
      },
      fontFamily: {
        titre: "var(--font-titre)",
        corps: "var(--font-corps)",
        code: "var(--font-code)",
      },
      maxWidth: {
        mesure: "var(--mesure)",
      },
      borderRadius: {
        DEFAULT: "var(--rayon)",
        lg: "var(--rayon-lg)",
      },
    },
  },
  plugins: [],
} satisfies Config;

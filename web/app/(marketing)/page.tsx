import type { Metadata } from "next";

/* Page de référence du design — provisoire, supprimée à l'étape 2 (progress.md).
   Elle sert à vérifier les jetons du §6 sur un vrai écran, pas à vendre quoi que ce soit. */

export const metadata: Metadata = {
  title: "Référence de design — anis.dev",
  robots: { index: false, follow: false },
};

const palette = [
  {
    jeton: "--paper",
    valeur: "#FAFAF7",
    usage: "Fond. La seule surface de la page.",
    classe: "bg-paper",
    bordure: true,
  },
  {
    jeton: "--ink",
    valeur: "#14201E",
    usage: "Texte principal. Vert-noir, jamais un noir neutre.",
    classe: "bg-ink",
    bordure: false,
  },
  {
    jeton: "--zellige",
    valeur: "#0E6E63",
    usage: "Primaire : liens, boutons, état terminé.",
    classe: "bg-zellige",
    bordure: false,
  },
  {
    jeton: "--safran",
    valeur: "#E0A22B",
    usage: "Progression et étape courante. Jamais de la décoration.",
    classe: "bg-safran",
    bordure: false,
  },
  {
    jeton: "--muted",
    valeur: "#6E7B78",
    usage: "Texte secondaire, bordures.",
    classe: "bg-muted",
    bordure: false,
  },
  {
    jeton: "--danger",
    valeur: "#B4342A",
    usage: "Erreurs et actions destructives, rien d'autre.",
    classe: "bg-danger",
    bordure: false,
  },
] as const;

const echelle = [
  { jeton: "--texte-5xl", taille: "4rem", role: "Titre de héros" },
  { jeton: "--texte-4xl", taille: "3rem", role: "Titre de page" },
  { jeton: "--texte-3xl", taille: "2.25rem", role: "Titre de section" },
  { jeton: "--texte-2xl", taille: "1.75rem", role: "Titre de bloc" },
  { jeton: "--texte-xl", taille: "1.375rem", role: "Chapeau" },
  { jeton: "--texte-lg", taille: "1.125rem", role: "Corps large" },
  { jeton: "--texte-base", taille: "1rem", role: "Corps — plancher absolu" },
  { jeton: "--texte-sm", taille: "0.9375rem", role: "Secondaire" },
  { jeton: "--texte-xs", taille: "0.8125rem", role: "Métadonnée" },
] as const;

export default function ReferenceDesign() {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 sm:py-20">
      <header className="border-b pb-10" style={{ borderColor: "var(--muted)" }}>
        <h1 className="font-titre text-[length:var(--texte-4xl)] font-semibold">
          Référence de design
        </h1>
        <p className="mt-4 max-w-mesure text-[length:var(--texte-lg)] text-muted">
          Les jetons de CLAUDE.md §6, rendus. Cette page disparaît à l&apos;étape 2, quand
          la vraie landing la remplace.
        </p>
      </header>

      <section className="mt-16" aria-labelledby="titre-palette">
        <h2 id="titre-palette" className="font-titre text-[length:var(--texte-2xl)] font-semibold">
          Palette
        </h2>
        <ul className="mt-6 grid gap-px" style={{ background: "var(--muted)" }}>
          {palette.map((couleur) => (
            <li
              key={couleur.jeton}
              className="flex flex-col gap-4 bg-paper p-4 sm:flex-row sm:items-center"
            >
              <span
                aria-hidden="true"
                className={`h-12 w-full shrink-0 sm:w-24 ${couleur.classe}`}
                style={couleur.bordure ? { boxShadow: "inset 0 0 0 1px var(--muted)" } : undefined}
              />
              <span className="flex flex-1 flex-col gap-1">
                <code className="text-[length:var(--texte-sm)]">
                  {couleur.jeton} {couleur.valeur}
                </code>
                <span className="text-[length:var(--texte-sm)] text-muted">{couleur.usage}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16" aria-labelledby="titre-echelle">
        <h2 id="titre-echelle" className="font-titre text-[length:var(--texte-2xl)] font-semibold">
          Échelle typographique
        </h2>
        <p className="mt-3 max-w-mesure text-muted">
          Titres en Bricolage Grotesque, corps en Public Sans, code en JetBrains Mono. La
          mono ne sert qu&apos;à du vrai code.
        </p>
        <dl className="mt-8 flex flex-col gap-8">
          {echelle.map((niveau) => (
            <div key={niveau.jeton} className="flex flex-col gap-2">
              <dt className="text-[length:var(--texte-xs)] text-muted">
                <code>{niveau.jeton}</code>
                <span className="ml-3">{niveau.taille}</span>
                <span className="ml-3">{niveau.role}</span>
              </dt>
              <dd
                className="font-titre font-semibold"
                style={{ fontSize: `var(${niveau.jeton})` }}
              >
                Construis ton application
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-16" aria-labelledby="titre-corps">
        <h2 id="titre-corps" className="font-titre text-[length:var(--texte-2xl)] font-semibold">
          Corps de texte et code
        </h2>
        <p className="mt-6 max-w-mesure">
          Une ligne de texte reste sous 72 caractères pour qu&apos;on la lise sans effort sur
          un écran de téléphone. Le corps ne descend jamais sous 16 pixels, même dans les
          zones denses de l&apos;espace étudiant.
        </p>
        <pre className="mt-6 overflow-x-auto p-4 text-[length:var(--texte-sm)] text-paper"
             style={{ background: "var(--ink)", borderRadius: "var(--rayon)" }}>
          <code>{`void main() {
  runApp(const MonApplication());
}`}</code>
        </pre>
      </section>

      <section className="mt-16" aria-labelledby="titre-etats">
        <h2 id="titre-etats" className="font-titre text-[length:var(--texte-2xl)] font-semibold">
          États du parcours
        </h2>
        <ul className="mt-6 flex flex-wrap gap-4">
          <li className="flex items-center gap-3 text-[length:var(--texte-sm)]">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-full bg-zellige text-paper"
            >
              ✓
            </span>
            Terminé
          </li>
          <li className="flex items-center gap-3 text-[length:var(--texte-sm)]">
            <span
              aria-hidden="true"
              className="h-8 w-8 rounded-full"
              style={{ boxShadow: "0 0 0 3px var(--safran)" }}
            />
            En cours
          </li>
          <li className="flex items-center gap-3 text-[length:var(--texte-sm)]">
            <span
              aria-hidden="true"
              className="h-8 w-8 rounded-full bg-paper"
              style={{ boxShadow: "0 0 0 1.5px var(--ink)" }}
            />
            Disponible
          </li>
          <li className="flex items-center gap-3 text-[length:var(--texte-sm)] opacity-45">
            <span
              aria-hidden="true"
              className="h-8 w-8 rounded-full bg-paper"
              style={{ boxShadow: "0 0 0 1.5px var(--ink)" }}
            />
            Recommandé plus tard
          </li>
        </ul>
      </section>

      <footer className="mt-16 border-t pt-8 text-[length:var(--texte-sm)] text-muted"
              style={{ borderColor: "var(--muted)" }}>
        <p>
          État du service :{" "}
          <a className="underline underline-offset-4" style={{ color: "var(--zellige)" }} href="/api/health">
            /api/health
          </a>
        </p>
      </footer>
    </main>
  );
}

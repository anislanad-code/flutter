import type { Metadata } from "next";

import { ECHELLE, PALETTE } from "@/lib/design-tokens";

/* Page de référence du design — provisoire, supprimée à l'étape 2 (progress.md).
   Elle sert à vérifier les jetons du §6 sur un vrai écran, pas à vendre quoi que ce soit. */

export const metadata: Metadata = {
  title: "Référence de design — anis.dev",
  robots: { index: false, follow: false },
};

export default function ReferenceDesign() {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 sm:py-20">
      <header className="border-b border-muted/40 pb-10">
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
        <ul className="mt-6 grid gap-px bg-muted/40">
          {PALETTE.map((couleur) => (
            <li
              key={couleur.jeton}
              className="flex flex-col gap-4 bg-paper p-4 sm:flex-row sm:items-center"
            >
              <span
                aria-hidden="true"
                className={`h-12 w-full shrink-0 sm:w-24 ${couleur.classe} ${
                  couleur.contourne ? "ring-1 ring-inset ring-muted" : ""
                }`}
              />
              <span className="flex flex-1 flex-col gap-1">
                <span className="text-[length:var(--texte-sm)] font-medium">
                  {couleur.jeton} {couleur.valeur}
                </span>
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
          {ECHELLE.map((niveau) => (
            <div key={niveau.jeton} className="flex flex-col gap-2">
              <dt className="text-[length:var(--texte-xs)] text-muted">
                <span className="font-medium">{niveau.jeton}</span>
                <span className="ml-3">{niveau.valeur}</span>
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
        <pre className="mt-6 overflow-x-auto rounded bg-ink p-4 text-[length:var(--texte-sm)] text-paper">
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
              className="h-8 w-8 rounded-full ring-[3px] ring-safran"
            />
            En cours
          </li>
          <li className="flex items-center gap-3 text-[length:var(--texte-sm)]">
            <span
              aria-hidden="true"
              className="h-8 w-8 rounded-full bg-paper ring-[1.5px] ring-ink"
            />
            Disponible
          </li>
          <li className="flex items-center gap-3 text-[length:var(--texte-sm)] opacity-45">
            <span
              aria-hidden="true"
              className="h-8 w-8 rounded-full bg-paper ring-[1.5px] ring-ink"
            />
            Recommandé plus tard
          </li>
        </ul>
      </section>

      <footer className="mt-16 border-t border-muted/40 pt-8 text-[length:var(--texte-sm)] text-muted">
        <p>
          État du service :{" "}
          <a className="text-zellige underline underline-offset-4" href="/api/health">
            /api/health
          </a>
        </p>
      </footer>
    </main>
  );
}

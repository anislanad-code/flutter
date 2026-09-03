import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Public_Sans } from "next/font/google";
import { headers } from "next/headers";

import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "anis.dev — Formations tech en français",
  description:
    "Apprends à construire des applications mobiles avec Flutter et Firebase, en partant de zéro.",
};

/* Lire le nonce ici n'est pas décoratif : c'est ce qui bascule le rendu en dynamique.
   Une page prérendue en statique a un HTML figé au build, donc sans nonce, et la CSP
   posée par le middleware bloque alors tous ses scripts — page morte en production.
   Le prix est un rendu par requête ; l'étape 2 devra revoir la question pour la
   landing publique (CSP à empreintes, ou cache en amont). */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="fr"
      className={`${bricolage.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {children}
        {/* Next tamponne ses propres scripts avec ce nonce dès qu'il le voit passer. */}
        <meta name="csp-nonce" content={nonce} />
      </body>
    </html>
  );
}

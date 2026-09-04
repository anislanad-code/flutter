import Link from "next/link";

export function EnTeteMarketing() {
  return (
    <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-6 sm:px-8">
      <Link href="/" className="font-titre text-[length:var(--texte-lg)] font-semibold">
        anis.dev
      </Link>
      <Link
        href="/connexion"
        className="text-[length:var(--texte-sm)] text-ink underline-offset-4 hover:underline"
      >
        Se connecter
      </Link>
    </header>
  );
}

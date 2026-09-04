import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Qcm } from "@/components/assessment/Qcm";
import { recupererQuiz } from "@/lib/assessment";
import { utilisateurCourant } from "@/lib/current-user";

export const metadata: Metadata = {
  title: "QCM — anis.dev",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

/* Un QCM de chapitre ou un examen de module (étape 6). L'id n'est pas devinable en
   pratique (auto-incrément Django), mais même trouvé, le paywall reste entièrement
   côté serveur : un compte sans droit dessus reçoit la même 404 qu'un id inexistant
   (§4.4 — voir `apps.assessment.services.a_acces_au_quiz`). */
export default async function PageQcm({ params }: Props) {
  const { id } = await params;
  const idNumerique = Number(id);
  if (!Number.isInteger(idNumerique) || idNumerique <= 0) notFound();

  const utilisateur = await utilisateurCourant();
  if (!utilisateur) redirect(`/connexion?suite=/app/qcm/${id}`);

  const resultat = await recupererQuiz(idNumerique);
  if (!resultat.ok) {
    if (resultat.raison === "inaccessible") notFound();
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-5 py-16">
        <p role="alert" className="text-[length:var(--texte-base)] text-danger">
          Ce QCM n&apos;a pas pu être chargé. Recharge la page — rien n&apos;a été
          perdu.
        </p>
        <Link
          href="/app"
          className="self-start text-[length:var(--texte-sm)] text-zellige underline underline-offset-4"
        >
          Retour à ton parcours
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-16">
      <header>
        <h1 className="font-titre text-[length:var(--texte-3xl)] font-semibold text-ink">
          {resultat.quiz.kind === "examen" ? "Examen de module" : "QCM de chapitre"}
        </h1>
      </header>
      <Qcm
        quiz={resultat.quiz}
        retourHref="/app"
        retourLibelle="Retour à ton parcours"
      />
    </main>
  );
}

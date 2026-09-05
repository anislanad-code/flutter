"use client";

import Link from "next/link";
import { useState } from "react";

import type { EtatQuiz, ResultatTentative } from "@/lib/assessment-schemas";
import { resultatTentativeSchema, tentativeDemarreeSchema } from "@/lib/assessment-schemas";

type Props = {
  quiz: EtatQuiz;
  /** Aujourd'hui toujours `/app` (le pipeline) : `EtatQuiz` ne transporte ni le slug
   *  du chapitre ni celui du module, donc un retour direct vers la leçon n'est pas
   *  encore possible sans une deuxième requête. Documenté ici plutôt que promis. */
  retourHref: string;
  retourLibelle: string;
};

type Etape =
  | { phase: "intro" }
  | { phase: "demarrage" }
  | {
      phase: "question";
      attemptId: number;
      index: number;
      reponses: Record<number, number>;
    }
  | { phase: "recap"; attemptId: number; reponses: Record<number, number> }
  | { phase: "envoi" }
  | { phase: "resultat"; resultat: ResultatTentative }
  | { phase: "erreur"; message: string };

const MESSAGE_GENERIQUE = "Quelque chose a échoué. Réessaie dans un instant.";

function detailDuCorps(corps: unknown): string | null {
  return typeof corps === "object" && corps !== null && "detail" in corps
    ? String((corps as { detail: unknown }).detail)
    : null;
}

/* Un QCM de chapitre (§6 : une question à la fois, pas de compte à rebours anxiogène)
   et un examen de module (récapitulatif avant envoi, format plus formel) partagent le
   même composant — seul `quiz.kind` change le déroulé, pas le code qui pose les
   questions et corrige. */
export function Qcm({ quiz, retourHref, retourLibelle }: Props) {
  const [etape, setEtape] = useState<Etape>({ phase: "intro" });
  const [attemptsRestantes, setAttemptsRestantes] = useState(quiz.attempts_remaining);
  // Erreur d'un envoi qui n'a rien détruit (rythme trop rapide, limite de débit) :
  // affichée à côté du bouton d'envoi, jamais en remplaçant l'écran — les réponses
  // saisies restent là, prêtes à être renvoyées (§6, MAJEUR 5 de la relecture d'étape).
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);

  async function demarrer(): Promise<void> {
    setEtape({ phase: "demarrage" });
    try {
      const reponse = await fetch(`/api/quizzes/${quiz.id}/attempts`, { method: "POST" });
      if (reponse.status === 401) {
        setEtape({
          phase: "erreur",
          message: "Ta session a expiré. Reconnecte-toi pour continuer.",
        });
        return;
      }
      if (reponse.status === 409) {
        setEtape({
          phase: "erreur",
          message: "Tu as utilisé toutes tes tentatives pour ce QCM.",
        });
        return;
      }
      if (!reponse.ok) {
        setEtape({ phase: "erreur", message: MESSAGE_GENERIQUE });
        return;
      }
      const parsed = tentativeDemarreeSchema.safeParse(await reponse.json());
      if (!parsed.success) {
        setEtape({ phase: "erreur", message: "Réponse inattendue du serveur." });
        return;
      }
      setEtape({ phase: "question", attemptId: parsed.data.id, index: 0, reponses: {} });
    } catch {
      setEtape({ phase: "erreur", message: MESSAGE_GENERIQUE });
    }
  }

  async function envoyer(
    attemptId: number,
    reponses: Record<number, number>,
    origine: "question" | "recap",
  ): Promise<void> {
    const revenir = (): Etape =>
      origine === "recap"
        ? { phase: "recap", attemptId, reponses }
        : { phase: "question", attemptId, index: quiz.questions.length - 1, reponses };

    setErreurEnvoi(null);
    setEtape({ phase: "envoi" });
    try {
      const reponse = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: reponses }),
      });
      if (reponse.status === 401) {
        setEtape({
          phase: "erreur",
          message: "Ta session a expiré. Reconnecte-toi pour voir ton résultat.",
        });
        return;
      }
      if (reponse.status === 400 || reponse.status === 429) {
        // Récupérable par nature (rythme trop rapide, débit) : l'étudiant n'a rien à
        // corriger dans ses réponses, seulement à réessayer — elles restent donc là.
        const corps: unknown = await reponse.json().catch(() => null);
        const message =
          reponse.status === 429
            ? "Trop de tentatives. Réessaie dans un instant."
            : (detailDuCorps(corps) ?? "Réponds un peu plus lentement avant d'envoyer.");
        setErreurEnvoi(message);
        setEtape(revenir());
        return;
      }
      if (!reponse.ok) {
        setEtape({ phase: "erreur", message: MESSAGE_GENERIQUE });
        return;
      }
      const parsed = resultatTentativeSchema.safeParse(await reponse.json());
      if (!parsed.success) {
        setEtape({ phase: "erreur", message: "Réponse inattendue du serveur." });
        return;
      }
      setAttemptsRestantes(parsed.data.attempts_remaining);
      setEtape({ phase: "resultat", resultat: parsed.data });
    } catch {
      setErreurEnvoi(MESSAGE_GENERIQUE);
      setEtape(revenir());
    }
  }

  if (etape.phase === "intro" || etape.phase === "demarrage") {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-mesure text-[length:var(--texte-base)] text-ink">
          {quiz.kind === "examen"
            ? `Examen de module — ${quiz.questions.length} questions, ${quiz.pass_threshold} % pour réussir.`
            : `QCM de chapitre — ${quiz.questions.length} questions, ${quiz.pass_threshold} % pour réussir.`}
        </p>
        {quiz.best_score !== null ? (
          <p className="text-[length:var(--texte-sm)] text-muted">
            Ton meilleur score : {quiz.best_score} %.
          </p>
        ) : null}
        {attemptsRestantes <= 0 ? (
          <p role="alert" className="text-[length:var(--texte-base)] text-danger">
            Tu as utilisé toutes tes tentatives pour ce QCM.
          </p>
        ) : (
          <button
            type="button"
            onClick={demarrer}
            disabled={etape.phase === "demarrage"}
            className="min-h-11 self-start rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {etape.phase === "demarrage" ? "Préparation…" : "Commencer"}
          </button>
        )}
        <Link
          href={retourHref}
          className="self-start text-[length:var(--texte-sm)] text-zellige underline underline-offset-4"
        >
          {retourLibelle}
        </Link>
      </div>
    );
  }

  if (etape.phase === "erreur") {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-[length:var(--texte-base)] text-danger">
          {etape.message}
        </p>
        <Link
          href={retourHref}
          className="self-start text-[length:var(--texte-sm)] text-zellige underline underline-offset-4"
        >
          {retourLibelle}
        </Link>
      </div>
    );
  }

  if (etape.phase === "envoi") {
    return (
      <p role="status" className="text-[length:var(--texte-base)] text-ink">
        Envoi de tes réponses…
      </p>
    );
  }

  if (etape.phase === "resultat") {
    const { resultat } = etape;
    // Corriger *complètement* un échec puis proposer « Recommencer » rendrait la
    // tentative suivante triviale (la bonne réponse vient d'être donnée) — la
    // correction intégrale n'apparaît donc qu'à la réussite ou quand il ne reste plus
    // de tentative ; entre les deux, seul « correct / incorrect » est dit (MAJEUR 4 de
    // la relecture d'étape : le plafond de tentatives doit rester un vrai plafond).
    const reveleTout = resultat.passed || resultat.attempts_remaining <= 0;
    return (
      <div className="flex flex-col gap-8">
        <div
          className={`flex flex-col gap-2 border-l-2 bg-paper py-1 pl-5 ${
            resultat.passed ? "border-zellige" : "border-danger"
          }`}
        >
          <h2 className="font-titre text-[length:var(--texte-xl)] font-semibold text-ink">
            {resultat.passed
              ? "Réussi"
              : `Score insuffisant — ${resultat.pass_threshold} % requis`}
          </h2>
          <p className="text-[length:var(--texte-base)] text-ink">
            Score : {resultat.score} %.
          </p>
          {!reveleTout ? (
            <p className="text-[length:var(--texte-sm)] text-muted">
              La correction détaillée s&apos;affiche à ta dernière tentative.
            </p>
          ) : null}
        </div>

        <ol className="flex flex-col gap-6">
          {resultat.questions.map((question, index) => {
            const choixCorrect = question.choices.find((c) => c.is_correct);
            const aReussi = question.choices.some((c) => c.chosen && c.is_correct);
            return (
              <li key={question.id} className="flex flex-col gap-2">
                <p className="text-[length:var(--texte-base)] font-medium text-ink">
                  {index + 1}. {question.text}
                </p>
                <p
                  className={`text-[length:var(--texte-sm)] ${aReussi ? "text-zellige" : "text-danger"}`}
                >
                  {aReussi
                    ? "Bonne réponse."
                    : reveleTout
                      ? `Bonne réponse : ${choixCorrect?.text ?? "—"}`
                      : "Réponse incorrecte."}
                </p>
                {reveleTout && question.explanation ? (
                  <p className="max-w-mesure text-[length:var(--texte-sm)] text-muted">
                    {question.explanation}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-4">
          {resultat.attempts_remaining > 0 ? (
            <button
              type="button"
              onClick={() => setEtape({ phase: "intro" })}
              className="min-h-11 rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90"
            >
              Recommencer
            </button>
          ) : null}
          <Link
            href={retourHref}
            className="text-[length:var(--texte-sm)] text-zellige underline underline-offset-4"
          >
            {retourLibelle}
          </Link>
        </div>
      </div>
    );
  }

  if (etape.phase === "recap") {
    const { attemptId, reponses } = etape;
    return (
      <div className="flex flex-col gap-6">
        <h2 className="font-titre text-[length:var(--texte-xl)] font-semibold text-ink">
          Vérifie tes réponses avant d&apos;envoyer
        </h2>
        <ol className="flex flex-col gap-3">
          {quiz.questions.map((question, index) => {
            const choisi = question.choices.find((c) => c.id === reponses[question.id]);
            return (
              <li
                key={question.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-muted/30 pb-2"
              >
                <span className="text-[length:var(--texte-sm)] text-ink">
                  {index + 1}. {question.text}
                </span>
                <span className="text-[length:var(--texte-sm)] text-muted">
                  {choisi ? choisi.text : "Pas de réponse"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setErreurEnvoi(null);
                    setEtape({ phase: "question", attemptId, index, reponses });
                  }}
                  className="text-[length:var(--texte-xs)] text-zellige underline underline-offset-4"
                >
                  Modifier
                </button>
              </li>
            );
          })}
        </ol>
        {erreurEnvoi ? (
          <p role="alert" className="text-[length:var(--texte-sm)] text-danger">
            {erreurEnvoi}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void envoyer(attemptId, reponses, "recap")}
          className="min-h-11 self-start rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90"
        >
          Envoyer mes réponses
        </button>
      </div>
    );
  }

  // phase === "question"
  const { attemptId, index, reponses } = etape;
  const question = quiz.questions[index];
  if (!question) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-[length:var(--texte-base)] text-danger">
          Ce QCM n&apos;a pas encore de question.
        </p>
        <Link
          href={retourHref}
          className="self-start text-[length:var(--texte-sm)] text-zellige underline underline-offset-4"
        >
          {retourLibelle}
        </Link>
      </div>
    );
  }
  const derniere = index === quiz.questions.length - 1;
  const reponseChoisie = reponses[question.id];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[length:var(--texte-xs)] text-muted" aria-live="polite">
        Question {index + 1}/{quiz.questions.length}
      </p>
      <fieldset className="flex flex-col gap-4">
        <legend className="text-[length:var(--texte-lg)] font-medium text-ink">
          {question.text}
        </legend>
        <div className="flex flex-col gap-2">
          {question.choices.map((choix) => (
            <label
              key={choix.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded border border-muted/40 px-4 py-2.5 has-[:checked]:border-zellige has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-safran"
            >
              <input
                type="radio"
                name={`question-${question.id}`}
                value={choix.id}
                checked={reponseChoisie === choix.id}
                onChange={() => {
                  setErreurEnvoi(null);
                  setEtape({
                    phase: "question",
                    attemptId,
                    index,
                    reponses: { ...reponses, [question.id]: choix.id },
                  });
                }}
                className="h-4 w-4 accent-zellige"
              />
              <span className="text-[length:var(--texte-base)] text-ink">{choix.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {erreurEnvoi && derniere ? (
        <p role="alert" className="text-[length:var(--texte-sm)] text-danger">
          {erreurEnvoi}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {index > 0 ? (
          <button
            type="button"
            onClick={() => {
              setErreurEnvoi(null);
              setEtape({ phase: "question", attemptId, index: index - 1, reponses });
            }}
            className="min-h-11 rounded border border-ink px-4 py-2.5 text-[length:var(--texte-base)] text-ink"
          >
            Précédent
          </button>
        ) : null}
        {derniere ? (
          <button
            type="button"
            disabled={reponseChoisie === undefined}
            onClick={() => {
              if (quiz.kind === "examen") {
                setEtape({ phase: "recap", attemptId, reponses });
              } else {
                void envoyer(attemptId, reponses, "question");
              }
            }}
            aria-describedby={reponseChoisie === undefined ? "qcm-choisis-une-reponse" : undefined}
            className="min-h-11 rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {quiz.kind === "examen" ? "Vérifier avant d'envoyer" : "Envoyer"}
          </button>
        ) : (
          <button
            type="button"
            disabled={reponseChoisie === undefined}
            onClick={() =>
              setEtape({ phase: "question", attemptId, index: index + 1, reponses })
            }
            aria-describedby={reponseChoisie === undefined ? "qcm-choisis-une-reponse" : undefined}
            className="min-h-11 rounded bg-zellige px-4 py-2.5 text-[length:var(--texte-base)] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Suivant
          </button>
        )}
      </div>
      {reponseChoisie === undefined ? (
        <p id="qcm-choisis-une-reponse" className="text-[length:var(--texte-xs)] text-muted">
          Choisis une réponse pour continuer.
        </p>
      ) : null}
    </div>
  );
}

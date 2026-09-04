"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { InscriptionAdmin } from "@/lib/enrollment-schemas";

type Props = {
  inscriptions: InscriptionAdmin[];
};

/* File de traitement. Dense et sobre : elle est faite pour enchaîner trente demandes,
   pas pour être belle en capture d'écran (§6). Aucun mouvement, aucune carte arrondie
   identique — une ligne, un séparateur, et l'action au bout. */
export function FileInscriptions({ inscriptions }: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [motifs, setMotifs] = useState<Record<number, string>>({});
  const [apercus, setApercus] = useState<Record<number, string>>({});

  async function agir(id: number, action: "accept" | "reject") {
    const motif = (motifs[id] ?? "").trim();
    if (action === "reject" && !motif) {
      setErreur("Écris le motif du refus : l'étudiant le reçoit tel quel.");
      return;
    }

    setEnCours(id);
    setErreur(null);
    try {
      const reponse = await fetch(`/api/admin/enrollments/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason: motif } : {}),
      });
      const donnees = await reponse.json().catch(() => ({}));

      if (!reponse.ok) {
        setErreur(
          typeof donnees.detail === "string" ? donnees.detail : "L'action n'a pas abouti.",
        );
        return;
      }
      router.refresh();
    } catch {
      setErreur("Impossible de contacter le serveur. Vérifie ta connexion.");
    } finally {
      setEnCours(null);
    }
  }

  if (inscriptions.length === 0) {
    return (
      <p className="text-[length:var(--texte-base)] text-ink">
        Rien à traiter. Les nouveaux reçus apparaîtront ici.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {erreur ? (
        <p role="alert" className="mb-4 text-[length:var(--texte-sm)] text-danger">
          {erreur}
        </p>
      ) : null}

      <ul className="divide-y divide-muted/30 border-y border-muted/30">
        {inscriptions.map((inscription) => {
          const preuve = inscription.preuves.find((p) => p.status === "SUBMITTED") ?? null;
          const apercu = apercus[inscription.id];

          return (
            <li key={inscription.id} className="flex flex-col gap-3 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <span className="text-[length:var(--texte-base)] font-medium text-ink">
                  {inscription.user_email}
                </span>
                <span className="text-[length:var(--texte-sm)] tabular-nums text-ink">
                  {inscription.reference}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-8 gap-y-1 text-[length:var(--texte-sm)] text-ink">
                <span>Téléphone : {inscription.user_phone || "non renseigné"}</span>
                <span>Statut : {inscription.status}</span>
                {preuve ? (
                  <span className="tabular-nums">
                    Déclaré : {preuve.amount_declared.toLocaleString("fr-DZ")} DA
                  </span>
                ) : null}
              </div>

              {preuve ? (
                <>
                  {preuve.content_type === "application/pdf" ? (
                    /* Un PDF ne s'affiche jamais dans l'onglet : il s'exécuterait dans
                       l'origine du site. Pièce jointe uniquement (§4.5). */
                    <a
                      href={`/api/admin/proofs/${preuve.id}/apercu`}
                      className="self-start rounded border border-ink px-3 py-1.5 text-[length:var(--texte-sm)] text-ink"
                    >
                      Télécharger le reçu (PDF)
                    </a>
                  ) : apercu ? (
                    /* Le reçu est servi par notre propre origine, à travers le BFF :
                       l'URL signée de Django ne descend jamais jusqu'au navigateur. */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={apercu}
                      alt={`Reçu déposé par ${inscription.user_email}`}
                      className="max-h-96 w-auto self-start rounded border border-muted/40 object-contain"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setApercus((etat) => ({
                          ...etat,
                          [inscription.id]: `/api/admin/proofs/${preuve.id}/apercu`,
                        }))
                      }
                      className="self-start rounded border border-ink px-3 py-1.5 text-[length:var(--texte-sm)] text-ink"
                    >
                      Voir le reçu
                    </button>
                  )}

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                      <label
                        htmlFor={`motif-${inscription.id}`}
                        className="text-[length:var(--texte-sm)] text-ink"
                      >
                        Motif, si tu refuses
                      </label>
                      <input
                        id={`motif-${inscription.id}`}
                        type="text"
                        maxLength={500}
                        value={motifs[inscription.id] ?? ""}
                        onChange={(evenement) =>
                          setMotifs((etat) => ({
                            ...etat,
                            [inscription.id]: evenement.target.value,
                          }))
                        }
                        className="rounded border border-muted bg-paper px-3 py-2 text-[length:var(--texte-sm)] text-ink outline-none focus-visible:border-zellige focus-visible:ring-2 focus-visible:ring-zellige/40"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={enCours === inscription.id}
                      onClick={() => agir(inscription.id, "accept")}
                      className="rounded bg-zellige px-4 py-2 text-[length:var(--texte-sm)] font-medium text-paper disabled:opacity-60"
                    >
                      Valider le versement
                    </button>
                    <button
                      type="button"
                      disabled={enCours === inscription.id}
                      onClick={() => agir(inscription.id, "reject")}
                      className="rounded border border-danger px-4 py-2 text-[length:var(--texte-sm)] font-medium text-danger disabled:opacity-60"
                    >
                      Refuser le reçu
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[length:var(--texte-sm)] text-ink">
                  Aucun reçu en attente pour cette inscription.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

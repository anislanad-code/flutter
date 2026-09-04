import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { ipDuVisiteur } from "@/lib/client-ip";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

/* Dépôt du reçu CCP. Le BFF ne valide **rien** du contenu du fichier : tout le pipeline
   du §4.5 (magic bytes, réencodage, chiffrement) vit dans Django, qui est le seul à
   décider. Ce qui suit n'est qu'un refus précoce des corps manifestement trop gros,
   pour ne pas transporter 100 Mo jusqu'à l'API avant de les jeter. */

const TAILLE_MAX_OCTETS = 5 * 1024 * 1024;
/* Marge pour l'enveloppe multipart (frontières, en-têtes de partie, champ montant). */
const MARGE_MULTIPART = 8192;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = enTetesSessionDepuis(request);
  if (!headers) {
    return NextResponse.json({ detail: "Session expirée." }, { status: 401 });
  }

  const longueur = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(longueur) && longueur > TAILLE_MAX_OCTETS + MARGE_MULTIPART) {
    return NextResponse.json(
      { detail: "Le fichier dépasse 5 Mo. Envoie une capture plus légère." },
      { status: 413 },
    );
  }

  let corps: FormData;
  try {
    corps = await request.formData();
  } catch {
    return NextResponse.json({ detail: "Envoi illisible. Réessaie." }, { status: 400 });
  }

  const fichier = corps.get("file");
  const montant = corps.get("amount_declared");
  if (!(fichier instanceof File) || fichier.size === 0) {
    return NextResponse.json({ detail: "Choisis une capture du reçu." }, { status: 400 });
  }
  if (fichier.size > TAILLE_MAX_OCTETS) {
    return NextResponse.json(
      { detail: "Le fichier dépasse 5 Mo. Envoie une capture plus légère." },
      { status: 413 },
    );
  }

  /* FormData reconstruit à partir des seules parties attendues : un champ surnuméraire
     glissé par le client (un `status`, un `enrollment`) n'atteint jamais Django (§4.3). */
  const sortie = new FormData();
  sortie.append("file", fichier, "recu");
  sortie.append("amount_declared", typeof montant === "string" ? montant : "");

  const result = await apiFetch<{ detail?: string }>(
    "/api/enrollment/proof",
    {
      method: "POST",
      body: sortie,
      // `Content-Type` volontairement absent : `fetch` doit poser lui-même la frontière
      // multipart, qu'on ne connaît pas ici.
      headers: { ...headers, "X-Forwarded-For": ipDuVisiteur(request) },
    },
    { acceptStatuses: [400, 401, 409, 413, 429], timeoutMs: 60_000 },
  );

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status === 201) {
    return NextResponse.json({ detail: "Reçu envoyé." }, { status: 201 });
  }
  if (result.status === 401) {
    return NextResponse.json({ detail: "Session expirée." }, { status: 401 });
  }

  /* Les messages de refus de fichier sont écrits pour l'étudiant et disent quoi
     corriger (§6) : on les relaie tels quels, mais seulement pour les statuts
     explicitement attendus ci-dessus — jamais un corps d'erreur non anticipé. */
  const detail =
    typeof result.data?.detail === "string" ? result.data.detail : "Envoi refusé. Réessaie.";
  return NextResponse.json({ detail }, { status: result.status });
}

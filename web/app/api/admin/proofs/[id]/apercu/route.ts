import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiFetch, apiFetchBinaire } from "@/lib/api";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

/* Aperçu d'une preuve pour l'admin.

   Deux allers-retours, et c'est voulu :
   1. `/url` fait émettre par Django une signature de 10 minutes liée à cet admin, et
      journalise la consultation dans `AuditLog` (§4.5) ;
   2. `/file` échange cette signature contre le fichier déchiffré.

   Le navigateur ne voit ni l'une ni l'autre : l'URL signée reste entre Next et Django
   (§3), et n'apparaît donc ni dans l'historique, ni dans un journal d'accès HTTP
   public, ni dans un `Referer`. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMEOUT_PREUVE_MS = 60_000;

const urlSigneeSchema = z.object({
  path: z.string(),
  expires: z.number().int(),
  signature: z.string().min(1),
  expires_in: z.number(),
});

/* Ce qu'on accepte de renvoyer au navigateur. Le type de contenu n'est jamais recopié
   depuis l'amont : on le remappe sur une allow-list, sinon un `text/html` renvoyé par
   erreur s'exécuterait dans l'origine du site. */
const TYPES_SERVIS = new Map<string, string>([
  ["image/jpeg", "image/jpeg"],
  ["image/png", "image/png"],
  ["application/pdf", "application/pdf"],
]);

type Contexte = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, contexte: Contexte): Promise<NextResponse> {
  const headers = enTetesSessionDepuis(request);
  if (!headers) {
    return NextResponse.json({ detail: "Session expirée." }, { status: 401 });
  }

  const { id } = await contexte.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ detail: "Introuvable." }, { status: 404 });
  }

  const emission = await apiFetch<unknown>(`/api/admin/proofs/${id}/url`, { headers }, {
    acceptStatuses: [401, 404],
    timeoutMs: TIMEOUT_PREUVE_MS,
  });
  if (!emission.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (emission.status !== 200) {
    return NextResponse.json({ detail: "Introuvable." }, { status: 404 });
  }

  const signee = urlSigneeSchema.safeParse(emission.data);
  if (!signee.success || signee.data.path !== `/api/admin/proofs/${id}/file`) {
    // Un chemin qui ne pointe pas là où on l'attend n'est jamais suivi : c'est ce qui
    // empêcherait une réponse détournée de faire appeler autre chose par le serveur.
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  const fichier = await apiFetchBinaire(
    signee.data.path,
    {
      headers: {
        ...headers,
        "X-Proof-Expires": String(signee.data.expires),
        "X-Proof-Signature": signee.data.signature,
      },
    },
    { timeoutMs: TIMEOUT_PREUVE_MS },
  );
  if (!fichier.ok) {
    return NextResponse.json({ detail: "Introuvable." }, { status: 404 });
  }

  const typeAmont = fichier.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const typeServi = TYPES_SERVIS.get(typeAmont);
  if (!typeServi) {
    return NextResponse.json({ detail: "Introuvable." }, { status: 404 });
  }

  return new NextResponse(fichier.contenu, {
    status: 200,
    headers: {
      "Content-Type": typeServi,
      // Un PDF ne s'ouvre pas dans l'onglet : en pièce jointe il ne s'exécute pas.
      // Les images, elles, doivent s'afficher dans la file d'attente de l'admin.
      "Content-Disposition":
        typeServi === "application/pdf" ? `attachment; filename="recu-${id}.pdf"` : "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      // Un reçu CCP ne se met pas en cache disque ni dans un proxy.
      "Cache-Control": "no-store, private, max-age=0",
      Vary: "Cookie",
    },
  });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiFetch } from "@/lib/api";
import { DEVICE_COOKIE } from "@/lib/auth-cookie-names";
import { ipDuVisiteur } from "@/lib/client-ip";
import { lectureSchema } from "@/lib/playback-schemas";
import { enTetesSessionDepuis } from "@/lib/session-headers";

export const dynamic = "force-dynamic";

function empreinte(request: NextRequest): string {
  return request.cookies.get(DEVICE_COOKIE)?.value ?? "";
}

function poserEmpreinte(reponse: NextResponse, request: NextRequest): void {
  if (request.cookies.get(DEVICE_COOKIE)) return;
  const estProd = process.env.NODE_ENV === "production";
  reponse.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    secure: estProd,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function POST(
  request: NextRequest,
  contexte: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await contexte.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
  }

  const session = enTetesSessionDepuis(request) ?? {};
  const headers: Record<string, string> = {
    ...session,
    "X-Forwarded-For": ipDuVisiteur(request),
  };
  const dv = empreinte(request);
  if (dv) headers["X-Device-Fingerprint"] = dv;

  const result = await apiFetch<unknown>(
    `/api/lessons/${id}/playback`,
    { method: "POST", headers, body: "{}" },
    { acceptStatuses: [401, 404, 429, 503] },
  );

  if (!result.ok) {
    return NextResponse.json({ detail: "Service indisponible." }, { status: 503 });
  }
  if (result.status === 429) {
    return NextResponse.json({ detail: "Trop de tentatives. Réessaie plus tard." }, { status: 429 });
  }
  if (result.status === 503) {
    return NextResponse.json({ detail: "Vidéo indisponible." }, { status: 503 });
  }
  if (result.status === 401) {
    return NextResponse.json({ detail: "Session invalide ou expirée." }, { status: 401 });
  }
  if (result.status !== 200) {
    return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
  }

  const parsed = lectureSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Réponse inattendue du serveur." }, { status: 502 });
  }

  const reponse = NextResponse.json(parsed.data, { status: 200 });
  poserEmpreinte(reponse, request);
  return reponse;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ detail: "Non trouvé." }, { status: 404 });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { apiFetch } from "@/lib/api";

/* BFF : le navigateur appelle cette route, la route appelle Django côté serveur.
   Aucune logique métier ici (§3). */

export const dynamic = "force-dynamic";

const healthSchema = z.object({
  status: z.literal("ok"),
  db: z.enum(["ok", "down"]),
});

export async function GET(): Promise<NextResponse> {
  const result = await apiFetch<unknown>("/api/health");

  if (!result.ok) {
    return NextResponse.json({ status: "down", api: "unreachable" }, { status: 503 });
  }

  // Le front ne fait jamais confiance à la forme des données renvoyées (§7).
  const parsed = healthSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ status: "down", api: "invalid_response" }, { status: 502 });
  }

  return NextResponse.json({ status: "ok", api: "ok", db: parsed.data.db });
}

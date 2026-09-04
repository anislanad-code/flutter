import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { ipDuVisiteur } from "@/lib/client-ip";

function requete(headers: Record<string, string>): NextRequest {
  return new NextRequest(new Request("https://anis.dev/", { headers }));
}

describe("ipDuVisiteur", () => {
  it("prend la première IP de X-Forwarded-For", () => {
    expect(ipDuVisiteur(requete({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("retombe sur X-Real-IP si X-Forwarded-For est absent", () => {
    expect(ipDuVisiteur(requete({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("renvoie une chaîne vide sans aucun des deux en-têtes", () => {
    expect(ipDuVisiteur(requete({}))).toBe("");
  });

  it("ignore un X-Forwarded-For vide et retombe sur X-Real-IP", () => {
    expect(ipDuVisiteur(requete({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" }))).toBe(
      "9.9.9.9",
    );
  });

  it("découpe une valeur dégénérée sans lever d'exception", () => {
    expect(ipDuVisiteur(requete({ "x-forwarded-for": " , 5.6.7.8" }))).toBe("");
  });
});

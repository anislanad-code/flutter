import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* Le BFF de l'inscription payante (étape 3).

   Ce que ces tests vérifient, et qui ne se voit pas dans Django : le serveur Next ne
   laisse jamais passer un champ surnuméraire vers l'API (§4.3), ne relaie jamais un
   corps d'erreur non anticipé, ne pose pas de cookie, et ne fait suivre l'URL signée
   d'une preuve jusqu'au navigateur (§4.5). */

const apiFetch = vi.hoisted(() => vi.fn());
const apiFetchBinaire = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch, apiFetchBinaire }));

const { GET: statut } = await import("@/app/api/enrollment/status/route");
const { POST: depot } = await import("@/app/api/enrollment/proof/route");
const { GET: fileAdmin } = await import("@/app/api/admin/enrollments/route");
const { POST: accepter } = await import("@/app/api/admin/enrollments/[id]/accept/route");
const { POST: refuser } = await import("@/app/api/admin/enrollments/[id]/reject/route");
const { GET: apercu } = await import("@/app/api/admin/proofs/[id]/apercu/route");

const SESSION = "session=jeton-de-session";
const PROOF_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const URL_SIGNEE = {
  path: `/api/admin/proofs/${PROOF_ID}/file`,
  expires: 99,
  signature: "abcdef",
  expires_in: 600,
};

const ETAT = {
  status: "PENDING",
  course_slug: "flutter-firebase-debutants",
  depot_possible: true,
  instructions: {
    provider: "MANUAL_CCP",
    requiert_preuve: true,
    amount_dzd: 12000,
    account_label: "CCP",
    account_number: "0012345678",
    account_key: "42",
    account_holder: "LANAD ANIS",
    reference: "ANISDEV-000001",
  },
  derniere_preuve: null,
};

const INSCRIPTION = {
  id: 1,
  status: "PENDING",
  user_email: "etudiante@example.com",
  user_phone: "0550112233",
  course_title: "Flutter + Firebase",
  reference: "ANISDEV-000001",
  note_admin: "",
  created_at: "2026-01-01T00:00:00Z",
  activated_at: null,
  preuves: [],
};

function requeteGet(url: string, cookie?: string): NextRequest {
  return new NextRequest(new Request(url, { headers: cookie ? { cookie } : undefined }));
}

function requeteJson(url: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(
    new Request(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: cookie ? { cookie } : undefined,
    }),
  );
}

function requeteMultipart(champs: Record<string, string | File>, cookie?: string): NextRequest {
  const corps = new FormData();
  for (const [nom, valeur] of Object.entries(champs)) corps.append(nom, valeur);
  return new NextRequest(
    new Request("http://localhost/api/enrollment/proof", {
      method: "POST",
      body: corps,
      headers: cookie ? { cookie } : undefined,
    }),
  );
}

function fichierJpeg(octets = 1024): File {
  return new File([new Uint8Array(octets)], "recu.jpg", { type: "image/jpeg" });
}

const ok = (data: unknown, status = 200) => ({ ok: true as const, status, data });
const INJOIGNABLE = { ok: false as const, status: 503, error: "api_unreachable" };

beforeEach(() => {
  apiFetch.mockReset();
  apiFetchBinaire.mockReset();
});

describe("GET /api/enrollment/status", () => {
  it("sans cookie de session : 401 sans appeler Django", async () => {
    const reponse = await statut(requeteGet("http://localhost/api/enrollment/status"));

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("relaie l'état validé par le schéma", async () => {
    apiFetch.mockResolvedValue(ok(ETAT));

    const reponse = await statut(requeteGet("http://localhost/api/enrollment/status", SESSION));

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({ status: "PENDING", depot_possible: true });
  });

  it("traduit le cookie du navigateur en cookie attendu par Django", async () => {
    apiFetch.mockResolvedValue(ok(ETAT));

    await statut(requeteGet("http://localhost/api/enrollment/status", SESSION));

    const entetes = (apiFetch.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(entetes.Cookie).toBe("access_token=jeton-de-session");
  });

  it("une réponse hors schéma donne 502, jamais le corps brut", async () => {
    apiFetch.mockResolvedValue(ok({ status: "INCONNU" }));

    const reponse = await statut(requeteGet("http://localhost/api/enrollment/status", SESSION));

    expect(reponse.status).toBe(502);
    expect(await reponse.text()).not.toContain("INCONNU");
  });

  it("Django injoignable : 503 sans détail interne", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);

    const reponse = await statut(requeteGet("http://localhost/api/enrollment/status", SESSION));

    expect(reponse.status).toBe(503);
    expect(await reponse.text()).not.toContain("api_unreachable");
  });

  it("un 401 de Django est traduit en session expirée", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 401, data: { detail: "Authentication credentials were not provided." } });

    const reponse = await statut(requeteGet("http://localhost/api/enrollment/status", SESSION));

    expect(reponse.status).toBe(401);
    expect((await reponse.json()).detail).toBe("Session expirée.");
  });
});

describe("POST /api/enrollment/proof", () => {
  it("sans session : 401 sans appeler Django", async () => {
    const reponse = await depot(requeteMultipart({ file: fichierJpeg() }));

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un dépôt valide est relayé et renvoie 201", async () => {
    apiFetch.mockResolvedValue(ok({ id: "x", status: "SUBMITTED" }, 201));

    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.status).toBe(201);
    expect(apiFetch.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
  });

  it("ne transmet que le fichier et le montant, jamais un champ glissé en plus", async () => {
    apiFetch.mockResolvedValue(ok({ id: "x", status: "SUBMITTED" }, 201));

    await depot(
      requeteMultipart(
        {
          file: fichierJpeg(),
          amount_declared: "12000",
          status: "ACCEPTED",
          is_staff: "true",
          enrollment: "42",
        },
        SESSION,
      ),
    );

    const transmis = (apiFetch.mock.calls[0]?.[1] as RequestInit).body as FormData;
    expect([...transmis.keys()].sort()).toEqual(["amount_declared", "file"]);
  });

  it("ne recopie jamais le nom de fichier fourni par le navigateur", async () => {
    apiFetch.mockResolvedValue(ok({ id: "x", status: "SUBMITTED" }, 201));
    const piege = new File([new Uint8Array(8)], "../../etc/passwd.jpg", { type: "image/jpeg" });

    await depot(requeteMultipart({ file: piege, amount_declared: "12000" }, SESSION));

    const transmis = (apiFetch.mock.calls[0]?.[1] as RequestInit).body as FormData;
    expect((transmis.get("file") as File).name).toBe("recu");
  });

  it("un fichier de plus de 5 Mo est refusé sans atteindre Django", async () => {
    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(6 * 1024 * 1024), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.status).toBe(413);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("une partie fichier absente est refusée sans atteindre Django", async () => {
    const reponse = await depot(requeteMultipart({ amount_declared: "12000" }, SESSION));

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("relaie le message de refus de Django, qui dit quoi corriger", async () => {
    apiFetch.mockResolvedValue(
      ok({ detail: "Format non accepté. Envoie une image JPEG ou PNG, ou un PDF." }, 400),
    );

    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.status).toBe(400);
    expect((await reponse.json()).detail).toContain("Format non accepté");
  });

  it("un corps d'erreur sans `detail` exploitable devient un message générique", async () => {
    apiFetch.mockResolvedValue(ok({ traceback: "File /app/apps/enrollment/views.py line 12" }, 400));

    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(), amount_declared: "12000" }, SESSION),
    );

    expect(await reponse.text()).not.toContain("views.py");
  });

  it("ne pose jamais de cookie", async () => {
    apiFetch.mockResolvedValue(ok({ id: "x", status: "SUBMITTED" }, 201));

    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.headers.getSetCookie()).toEqual([]);
  });

  it("un Content-Length trop gros est refusé avant de lire le corps", async () => {
    const corps = new FormData();
    corps.append("file", fichierJpeg());
    corps.append("amount_declared", "12000");
    const reponse = await depot(
      new NextRequest(
        new Request("http://localhost/api/enrollment/proof", {
          method: "POST",
          body: corps,
          headers: {
            cookie: SESSION,
            "content-length": String(6 * 1024 * 1024),
          },
        }),
      ),
    );

    expect(reponse.status).toBe(413);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un fichier vide est refusé sans atteindre Django", async () => {
    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(0), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un 409 de Django (reçu déjà en examen) est relayé", async () => {
    apiFetch.mockResolvedValue(
      ok({ detail: "Ton reçu est déjà en cours de vérification." }, 409),
    );

    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.status).toBe(409);
    expect((await reponse.json()).detail).toContain("déjà en cours");
  });

  it("Django injoignable : 503 sans détail interne", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);

    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.status).toBe(503);
    expect(await reponse.text()).not.toContain("api_unreachable");
  });

  it("un 401 de Django (session expirée côté API) est relayé", async () => {
    apiFetch.mockResolvedValue(ok({ detail: "Authentication credentials were not provided." }, 401));

    const reponse = await depot(
      requeteMultipart({ file: fichierJpeg(), amount_declared: "12000" }, SESSION),
    );

    expect(reponse.status).toBe(401);
    expect((await reponse.json()).detail).toBe("Session expirée.");
  });

  it("un corps non-multipart illisible est refusé sans Django", async () => {
    const reponse = await depot(
      new NextRequest(
        new Request("http://localhost/api/enrollment/proof", {
          method: "POST",
          body: "{pas du multipart}",
          headers: { cookie: SESSION, "content-type": "application/json" },
        }),
      ),
    );

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/enrollments", () => {
  it("sans session : 401", async () => {
    const reponse = await fileAdmin(requeteGet("http://localhost/api/admin/enrollments"));

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("relaie la file validée", async () => {
    apiFetch.mockResolvedValue(ok([INSCRIPTION]));

    const reponse = await fileAdmin(
      requeteGet("http://localhost/api/admin/enrollments?status=PENDING", SESSION),
    );

    expect(reponse.status).toBe(200);
    expect((await reponse.json())[0].user_email).toBe("etudiante@example.com");
  });

  it("un filtre hors allow-list est arrêté avant Django", async () => {
    for (const hostile of ["' OR 1=1 --", "user__password", "../"]) {
      apiFetch.mockClear();
      const reponse = await fileAdmin(
        requeteGet(
          `http://localhost/api/admin/enrollments?status=${encodeURIComponent(hostile)}`,
          SESSION,
        ),
      );

      expect(reponse.status).toBe(400);
      expect(apiFetch).not.toHaveBeenCalled();
    }
  });

  it("un compte non-admin reçoit le 404 de Django, pas un 403", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    const reponse = await fileAdmin(requeteGet("http://localhost/api/admin/enrollments", SESSION));

    expect(reponse.status).toBe(404);
  });

  it("Django injoignable : 503", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);

    const reponse = await fileAdmin(requeteGet("http://localhost/api/admin/enrollments", SESSION));

    expect(reponse.status).toBe(503);
  });

  it("une file hors schéma donne 502, jamais le corps brut", async () => {
    apiFetch.mockResolvedValue(ok([{ id: "pas-un-nombre" }]));

    const reponse = await fileAdmin(requeteGet("http://localhost/api/admin/enrollments", SESSION));

    expect(reponse.status).toBe(502);
    expect(await reponse.text()).not.toContain("pas-un-nombre");
  });
});

describe("POST /api/admin/enrollments/[id]/accept et /reject", () => {
  const contexte = (id: string) => ({ params: Promise.resolve({ id }) });

  it("accept sans session : 401", async () => {
    const reponse = await accepter(
      requeteJson("http://localhost/api/admin/enrollments/1/accept", {}),
      contexte("1"),
    );

    expect(reponse.status).toBe(401);
  });

  it("un identifiant non numérique est refusé sans atteindre Django", async () => {
    for (const id of ["1;DROP TABLE", "../../me", "abc"]) {
      apiFetch.mockClear();
      const reponse = await accepter(
        requeteJson("http://localhost/api/admin/enrollments/x/accept", {}, SESSION),
        contexte(id),
      );

      expect(reponse.status).toBe(404);
      expect(apiFetch).not.toHaveBeenCalled();
    }
  });

  it("accept relaie la validation", async () => {
    apiFetch.mockResolvedValue(ok({ id: 1, status: "ACTIVE" }));

    const reponse = await accepter(
      requeteJson("http://localhost/api/admin/enrollments/1/accept", {}, SESSION),
      contexte("1"),
    );

    expect(reponse.status).toBe(200);
  });

  it("reject sans motif est refusé avant Django", async () => {
    for (const corps of [{}, { reason: "" }, { reason: "   " }]) {
      apiFetch.mockClear();
      const reponse = await refuser(
        requeteJson("http://localhost/api/admin/enrollments/1/reject", corps, SESSION),
        contexte("1"),
      );

      expect(reponse.status).toBe(400);
      expect(apiFetch).not.toHaveBeenCalled();
    }
  });

  it("reject avec motif est relayé", async () => {
    apiFetch.mockResolvedValue(ok({ id: 1, status: "PENDING" }));

    const reponse = await refuser(
      requeteJson(
        "http://localhost/api/admin/enrollments/1/reject",
        { reason: "Montant illisible." },
        SESSION,
      ),
      contexte("1"),
    );

    expect(reponse.status).toBe(200);
    expect(JSON.parse(String((apiFetch.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      reason: "Montant illisible.",
    });
  });

  it("accept 409 relaie le motif métier", async () => {
    apiFetch.mockResolvedValue(ok({ detail: "Cette inscription n'a aucun reçu à examiner." }, 409));

    const reponse = await accepter(
      requeteJson("http://localhost/api/admin/enrollments/1/accept", {}, SESSION),
      contexte("1"),
    );

    expect(reponse.status).toBe(409);
    expect((await reponse.json()).detail).toContain("aucun reçu");
  });

  it("accept 409 sans détail devient un message générique", async () => {
    apiFetch.mockResolvedValue(ok({}, 409));

    const reponse = await accepter(
      requeteJson("http://localhost/api/admin/enrollments/1/accept", {}, SESSION),
      contexte("1"),
    );

    expect(reponse.status).toBe(409);
    expect((await reponse.json()).detail).toContain("aucun reçu à examiner");
  });

  it("reject 409 est relayé", async () => {
    apiFetch.mockResolvedValue(ok({ detail: "Cette inscription n'a aucun reçu à examiner." }, 409));

    const reponse = await refuser(
      requeteJson(
        "http://localhost/api/admin/enrollments/1/reject",
        { reason: "Illisible." },
        SESSION,
      ),
      contexte("1"),
    );

    expect(reponse.status).toBe(409);
  });

  it("reject sans session : 401", async () => {
    const reponse = await refuser(
      requeteJson("http://localhost/api/admin/enrollments/1/reject", { reason: "x" }),
      contexte("1"),
    );

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("accept Django injoignable : 503", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);

    const reponse = await accepter(
      requeteJson("http://localhost/api/admin/enrollments/1/accept", {}, SESSION),
      contexte("1"),
    );

    expect(reponse.status).toBe(503);
  });

  it("reject Django injoignable : 503", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);

    const reponse = await refuser(
      requeteJson(
        "http://localhost/api/admin/enrollments/1/reject",
        { reason: "Illisible." },
        SESSION,
      ),
      contexte("1"),
    );

    expect(reponse.status).toBe(503);
  });

  it("une note trop longue est refusée avant Django", async () => {
    const reponse = await accepter(
      requeteJson("http://localhost/api/admin/enrollments/1/accept", { note: "x".repeat(501) }, SESSION),
      contexte("1"),
    );

    expect(reponse.status).toBe(400);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("accept 404 de Django est traduit en Introuvable", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    const reponse = await accepter(
      requeteJson("http://localhost/api/admin/enrollments/1/accept", {}, SESSION),
      contexte("1"),
    );

    expect(reponse.status).toBe(404);
    expect((await reponse.json()).detail).toBe("Introuvable.");
  });

  it("reject identifiant non numérique : 404 sans Django", async () => {
    const reponse = await refuser(
      requeteJson("http://localhost/api/admin/enrollments/x/reject", { reason: "x" }, SESSION),
      contexte("abc"),
    );

    expect(reponse.status).toBe(404);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reject 409 sans détail devient un message générique", async () => {
    apiFetch.mockResolvedValue(ok({}, 409));

    const reponse = await refuser(
      requeteJson(
        "http://localhost/api/admin/enrollments/1/reject",
        { reason: "Illisible." },
        SESSION,
      ),
      contexte("1"),
    );

    expect(reponse.status).toBe(409);
    expect((await reponse.json()).detail).toContain("aucun reçu à examiner");
  });

  it("reject 404 de Django est traduit en Introuvable", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    const reponse = await refuser(
      requeteJson(
        "http://localhost/api/admin/enrollments/1/reject",
        { reason: "Illisible." },
        SESSION,
      ),
      contexte("1"),
    );

    expect(reponse.status).toBe(404);
  });
});

describe("GET /api/admin/proofs/[id]/apercu", () => {
  const contexte = (id: string) => ({ params: Promise.resolve({ id }) });

  it("sans session : 401", async () => {
    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("un identifiant qui n'est pas un UUID est refusé avant Django", async () => {
    for (const id of ["pas-un-uuid", "../../etc/passwd", "1"]) {
      apiFetch.mockClear();
      const reponse = await apercu(
        requeteGet("http://localhost/api/admin/proofs/x/apercu", SESSION),
        contexte(id),
      );

      expect(reponse.status).toBe(404);
      expect(apiFetch).not.toHaveBeenCalled();
    }
  });

  it("sert l'image et ne laisse jamais fuiter l'URL signée", async () => {
    const chemin = `/api/admin/proofs/${PROOF_ID}/file`;
    apiFetch.mockResolvedValue(ok(URL_SIGNEE));
    apiFetchBinaire.mockResolvedValue({
      ok: true,
      contenu: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
      contentType: "image/jpeg",
    });

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Content-Type")).toBe("image/jpeg");
    expect(reponse.headers.get("Cache-Control")).toContain("no-store");
    expect(reponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...reponse.headers.values()].join(" ")).not.toContain("signature=");
    expect(apiFetchBinaire).toHaveBeenCalledWith(
      chemin,
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Proof-Expires": "99",
          "X-Proof-Signature": "abcdef",
        }),
      }),
      { timeoutMs: 60_000 },
    );
  });

  it("un PDF est servi en pièce jointe, jamais en ligne", async () => {
    apiFetch.mockResolvedValue(
      ok(URL_SIGNEE),
    );
    apiFetchBinaire.mockResolvedValue({
      ok: true,
      contenu: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
      contentType: "application/pdf",
    });

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("un type de contenu hors allow-list n'est jamais servi", async () => {
    apiFetch.mockResolvedValue(
      ok(URL_SIGNEE),
    );
    apiFetchBinaire.mockResolvedValue({
      ok: true,
      contenu: new TextEncoder().encode("<script>alert(1)</script>").buffer,
      contentType: "text/html",
    });

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(404);
  });

  it("un chemin signé qui pointe ailleurs n'est jamais suivi", async () => {
    apiFetch.mockResolvedValue(ok({ path: "/api/me", expires: 99, signature: "x", expires_in: 600 }));

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(502);
    expect(apiFetchBinaire).not.toHaveBeenCalled();
  });

  it("un non-admin reçoit 404 et le fichier n'est jamais demandé", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 404, data: { detail: "Not found." } });

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(404);
    expect(apiFetchBinaire).not.toHaveBeenCalled();
  });

  it("l'émission d'URL injoignable : 503", async () => {
    apiFetch.mockResolvedValue(INJOIGNABLE);

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(503);
    expect(apiFetchBinaire).not.toHaveBeenCalled();
  });

  it("le fichier binaire introuvable : 404", async () => {
    apiFetch.mockResolvedValue(
      ok(URL_SIGNEE),
    );
    apiFetchBinaire.mockResolvedValue({ ok: false, status: 404 });

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(404);
  });

  it("un type JPEG avec charset est quand même servi", async () => {
    apiFetch.mockResolvedValue(
      ok(URL_SIGNEE),
    );
    apiFetchBinaire.mockResolvedValue({
      ok: true,
      contenu: new Uint8Array([0xff, 0xd8]).buffer,
      contentType: "image/jpeg; charset=utf-8",
    });

    const reponse = await apercu(
      requeteGet(`http://localhost/api/admin/proofs/${PROOF_ID}/apercu`, SESSION),
      contexte(PROOF_ID),
    );

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Content-Type")).toBe("image/jpeg");
    expect(reponse.headers.get("Content-Disposition")).toBe("inline");
  });
});

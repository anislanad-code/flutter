import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `lib/api.ts` est le seul point de contact avec Django (§3). Ce qu'on vérifie ici :
   - il rend un résultat typé et jamais une exception ;
   - il n'abandonne pas la requête sans borne (AbortController, 8 s) ;
   - il ne laisse jamais fuir `http://api:8000` vers l'appelant (§4.6, journalisation). */

const URL_INTERNE = "http://api:8000";

const environnementInitial = { ...process.env };

async function chargerApi() {
  vi.resetModules();
  process.env.API_INTERNAL_URL = URL_INTERNE;
  return await import("@/lib/api");
}

function reponse(corps: unknown, init: { status?: number; json?: () => Promise<unknown> } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: init.json ?? (async () => corps),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  process.env = { ...environnementInitial };
});

describe("apiFetch — chemin nominal", () => {
  it("renvoie les données quand Django répond 200", async () => {
    fetchMock.mockResolvedValue(reponse({ status: "ok", db: "ok" }));
    const { apiFetch } = await chargerApi();

    const resultat = await apiFetch<{ status: string }>("/api/health");

    expect(resultat).toEqual({ ok: true, status: 200, data: { status: "ok", db: "ok" } });
  });

  it("préfixe le chemin avec l'URL interne et coupe le cache", async () => {
    fetchMock.mockResolvedValue(reponse({}));
    const { apiFetch } = await chargerApi();

    await apiFetch("/api/health");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_INTERNE}/api/health`);
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeDefined();
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("laisse l'appelant surcharger les en-têtes et la méthode", async () => {
    fetchMock.mockResolvedValue(reponse({}));
    const { apiFetch } = await chargerApi();

    await apiFetch("/api/x", { method: "POST", headers: { Cookie: "session=abc" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Cookie")).toBe("session=abc");
  });

  it("conserve les en-têtes fournis sous forme d'instance Headers", async () => {
    /* Un étalement d'objet (`...init.headers`) perdait silencieusement une instance
       `Headers` : le cookie de session de l'étape 1 ne serait jamais parti. */
    fetchMock.mockResolvedValue(reponse({}));
    const { apiFetch } = await chargerApi();

    await apiFetch("/api/x", { headers: new Headers({ Cookie: "session=abc" }) });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Cookie")).toBe("session=abc");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("laisse l'appelant imposer son propre Content-Type", async () => {
    fetchMock.mockResolvedValue(reponse({}));
    const { apiFetch } = await chargerApi();

    await apiFetch("/api/x", { headers: { "Content-Type": "multipart/form-data" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Content-Type")).toBe("multipart/form-data");
  });

  it("ne relaie le corps d'un statut d'erreur que si l'appelant l'a explicitement accepté", async () => {
    /* La sonde de santé a besoin du corps d'un 503 de Django ; personne d'autre.
       Par défaut le corps d'erreur reste côté serveur (trace, nom de table, détail). */
    fetchMock.mockResolvedValue(reponse({ status: "degraded", db: "down" }, { status: 503 }));
    const { apiFetch } = await chargerApi();

    const refuse = await apiFetch("/api/health");
    expect(refuse).toEqual({ ok: false, status: 503, error: "api_error" });

    fetchMock.mockResolvedValue(reponse({ status: "degraded", db: "down" }, { status: 503 }));
    const accepte = await apiFetch("/api/health", {}, { acceptStatuses: [503] });
    expect(accepte).toEqual({ ok: true, status: 503, data: { status: "degraded", db: "down" } });
  });

  it("accepte un 204 sans corps JSON exploitable (data null, ok true)", async () => {
    fetchMock.mockResolvedValue(
      reponse(null, {
        status: 204,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      }),
    );
    const { apiFetch } = await chargerApi();

    const resultat = await apiFetch("/api/vide");

    expect(resultat).toEqual({ ok: true, status: 204, data: null });
  });
});

describe("apiFetch — chemins d'erreur", () => {
  it.each([400, 401, 403, 404, 500, 502])("transforme un %i en échec sans corps", async (code) => {
    fetchMock.mockResolvedValue(reponse({ detail: "peu importe" }, { status: code }));
    const { apiFetch } = await chargerApi();

    const resultat = await apiFetch("/api/x");

    expect(resultat).toEqual({ ok: false, status: code, error: "api_error" });
  });

  it("ne relaie pas le corps d'erreur de Django (pas de trace, pas de détail)", async () => {
    fetchMock.mockResolvedValue(
      reponse(
        { detail: 'relation "accounts_user" does not exist', traceback: "File /app/api/..." },
        { status: 500 },
      ),
    );
    const { apiFetch } = await chargerApi();

    const resultat = await apiFetch("/api/x");

    const serialise = JSON.stringify(resultat);
    expect(serialise).not.toContain("accounts_user");
    expect(serialise).not.toContain("traceback");
    expect(serialise).not.toContain("/app/api");
  });

  it("renvoie un corps non JSON comme une donnée nulle plutôt qu'une exception", async () => {
    fetchMock.mockResolvedValue(
      reponse(null, {
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      }),
    );
    const { apiFetch } = await chargerApi();

    const resultat = await apiFetch("/api/x");

    expect(resultat).toEqual({ ok: true, status: 200, data: null });
  });

  it("renvoie 503 api_unreachable sur panne réseau", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { apiFetch } = await chargerApi();

    const resultat = await apiFetch("/api/health");

    expect(resultat).toEqual({ ok: false, status: 503, error: "api_unreachable" });
  });

  it("échoue bruyamment si la configuration serveur manque, sans appeler fetch", async () => {
    /* Comportement constaté : `serverEnv()` est appelé hors du try/catch, donc une
       configuration absente rejette au lieu de renvoyer `ok: false`. C'est une erreur
       de déploiement, pas une erreur d'exécution : elle doit se voir. Ce qui compte
       ici, c'est qu'aucune requête ne parte et que le message ne contienne aucune valeur. */
    vi.resetModules();
    delete process.env.API_INTERNAL_URL;
    const { apiFetch } = await import("@/lib/api");

    await expect(apiFetch("/api/health")).rejects.toThrowError(/API_INTERNAL_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("apiFetch — délai maximum", () => {
  it("abandonne la requête au bout de 8 s et renvoie 503", async () => {
    vi.useFakeTimers();

    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const { apiFetch } = await chargerApi();

    const enCours = apiFetch("/api/lent");
    await vi.advanceTimersByTimeAsync(7_999);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/lent");

    await vi.advanceTimersByTimeAsync(2);

    await expect(enCours).resolves.toEqual({
      ok: false,
      status: 503,
      error: "api_unreachable",
    });
  });

  it("n'abandonne pas une requête qui répond avant l'échéance", async () => {
    vi.useFakeTimers();

    let signalRecu: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      signalRecu = init.signal ?? undefined;
      return reponse({ ok: true });
    });
    const { apiFetch } = await chargerApi();

    const resultat = await apiFetch("/api/rapide");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(resultat.ok).toBe(true);
    expect(signalRecu?.aborted).toBe(false);
  });

  it("honore un timeoutMs plus long que le défaut (upload de preuve)", async () => {
    vi.useFakeTimers();

    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const { apiFetch } = await chargerApi();

    const enCours = apiFetch("/api/enrollment/proof", { method: "POST" }, { timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(fetchMock).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(51_998);
    await vi.advanceTimersByTimeAsync(2);

    await expect(enCours).resolves.toEqual({
      ok: false,
      status: 503,
      error: "api_unreachable",
    });
  });
});

describe("apiFetch — non-divulgation de l'URL interne (§4.6)", () => {
  it.each([
    ["panne réseau", new TypeError(`request to ${URL_INTERNE}/api/health failed, ECONNREFUSED`)],
    ["DNS", new Error(`getaddrinfo ENOTFOUND api (${URL_INTERNE})`)],
    ["abandon", new DOMException("The operation was aborted.", "AbortError")],
  ])("ne laisse pas fuir l'hôte interne — cas %s", async (_nom, erreur) => {
    fetchMock.mockRejectedValue(erreur);
    const { apiFetch } = await chargerApi();

    const serialise = JSON.stringify(await apiFetch("/api/health"));

    expect(serialise).not.toContain("api:8000");
    expect(serialise).not.toContain("ECONNREFUSED");
    expect(serialise).not.toContain("ENOTFOUND");
  });

  it("ne laisse pas fuir l'hôte interne quand Django renvoie une erreur bavarde", async () => {
    fetchMock.mockResolvedValue(
      reponse({ detail: `upstream ${URL_INTERNE} said no` }, { status: 502 }),
    );
    const { apiFetch } = await chargerApi();

    expect(JSON.stringify(await apiFetch("/api/x"))).not.toContain("api:8000");
  });
});

describe("apiFetch — corps multipart", () => {
  it("laisse FormData poser son Content-Type, frontière comprise", async () => {
    fetchMock.mockResolvedValue(reponse({ ok: true }));
    const { apiFetch } = await chargerApi();

    const corps = new FormData();
    corps.append("amount_declared", "12000");
    await apiFetch("/api/enrollment/proof", { method: "POST", body: corps });

    const entetes = fetchMock.mock.calls[0]?.[1].headers as Headers;
    expect(entetes.has("Content-Type")).toBe(false);
  });

  it("continue de poser application/json sur un corps JSON", async () => {
    fetchMock.mockResolvedValue(reponse({ ok: true }));
    const { apiFetch } = await chargerApi();

    await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ a: 1 }) });

    const entetes = fetchMock.mock.calls[0]?.[1].headers as Headers;
    expect(entetes.get("Content-Type")).toBe("application/json");
  });
});

/* `apiFetchBinaire` ne sert aujourd'hui qu'à une chose : rapatrier une preuve de
   paiement déchiffrée par Django pour l'admin. Elle ne doit jamais mettre ce contenu
   en cache, ni relayer une erreur qui décrit l'amont (§4.5, §4.6). */
describe("apiFetchBinaire", () => {
  function reponseBinaire(
    octets: Uint8Array,
    init: { status?: number; contentType?: string | null } = {},
  ) {
    const status = init.status ?? 200;
    const contentType = init.contentType === undefined ? "image/jpeg" : init.contentType;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(contentType ? { "content-type": contentType } : {}),
      arrayBuffer: async () => octets.buffer,
    } as unknown as Response;
  }

  it("rend le contenu et son type quand Django répond 200", async () => {
    fetchMock.mockResolvedValue(reponseBinaire(new Uint8Array([0xff, 0xd8, 0xff])));
    const { apiFetchBinaire } = await chargerApi();

    const resultat = await apiFetchBinaire("/api/admin/proofs/x/file");

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(new Uint8Array(resultat.contenu)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(resultat.contentType).toBe("image/jpeg");
  });

  it("ne met jamais une preuve en cache", async () => {
    fetchMock.mockResolvedValue(reponseBinaire(new Uint8Array([1])));
    const { apiFetchBinaire } = await chargerApi();

    await apiFetchBinaire("/api/admin/proofs/x/file");

    expect(fetchMock.mock.calls[0]?.[1].cache).toBe("no-store");
  });

  it("retombe sur octet-stream si l'amont ne déclare pas de type", async () => {
    fetchMock.mockResolvedValue(reponseBinaire(new Uint8Array([1]), { contentType: null }));
    const { apiFetchBinaire } = await chargerApi();

    const resultat = await apiFetchBinaire("/api/admin/proofs/x/file");

    expect(resultat.ok && resultat.contentType).toBe("application/octet-stream");
  });

  it("relaie le statut d'échec sans le corps de l'amont", async () => {
    fetchMock.mockResolvedValue(reponseBinaire(new Uint8Array([1]), { status: 403 }));
    const { apiFetchBinaire } = await chargerApi();

    expect(await apiFetchBinaire("/api/admin/proofs/x/file")).toEqual({ ok: false, status: 403 });
  });

  it("Django injoignable : 503 sans trace de l'hôte interne", async () => {
    fetchMock.mockRejectedValue(new TypeError(`connect ECONNREFUSED ${URL_INTERNE}`));
    const { apiFetchBinaire } = await chargerApi();

    const resultat = await apiFetchBinaire("/api/admin/proofs/x/file");

    expect(resultat).toEqual({ ok: false, status: 503 });
    expect(JSON.stringify(resultat)).not.toContain("api:8000");
  });

  it("abandonne la requête au-delà du délai plutôt que de bloquer la page admin", async () => {
    vi.useFakeTimers();
    let signalRecu: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          signalRecu = init.signal ?? undefined;
          signalRecu?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const { apiFetchBinaire } = await chargerApi();

    const promesse = apiFetchBinaire("/api/admin/proofs/x/file");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await promesse).toEqual({ ok: false, status: 503 });
    expect(signalRecu?.aborted).toBe(true);
  });
});

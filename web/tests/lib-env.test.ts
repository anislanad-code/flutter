import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `lib/env.ts` mémorise sa lecture dans un module-level cache : chaque cas doit
   repartir d'un module neuf, sinon on teste le cache du cas précédent. */

const VALEUR_SENSIBLE = "http://api:8000";

async function chargerEnv() {
  vi.resetModules();
  return await import("@/lib/env");
}

const environnementInitial = { ...process.env };

beforeEach(() => {
  delete process.env.API_INTERNAL_URL;
});

afterEach(() => {
  process.env = { ...environnementInitial };
});

describe("serverEnv()", () => {
  it("renvoie l'URL interne quand la variable est présente et valide", async () => {
    process.env.API_INTERNAL_URL = VALEUR_SENSIBLE;

    const { serverEnv } = await chargerEnv();

    expect(serverEnv()).toEqual({ API_INTERNAL_URL: VALEUR_SENSIBLE });
  });

  it("échoue quand la variable est absente, en nommant la variable manquante", async () => {
    const { serverEnv } = await chargerEnv();

    expect(() => serverEnv()).toThrowError(/API_INTERNAL_URL/);
  });

  it("échoue quand la variable n'est pas une URL", async () => {
    process.env.API_INTERNAL_URL = "pas-une-url";

    const { serverEnv } = await chargerEnv();

    expect(() => serverEnv()).toThrow();
  });

  it("échoue quand la variable est une chaîne vide", async () => {
    process.env.API_INTERNAL_URL = "";

    const { serverEnv } = await chargerEnv();

    expect(() => serverEnv()).toThrow();
  });

  it("ne met jamais la valeur fautive dans le message d'erreur", async () => {
    process.env.API_INTERNAL_URL = "secret-interne-mot-de-passe-8000";

    const { serverEnv } = await chargerEnv();

    let message = "";
    try {
      serverEnv();
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : String(erreur);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("secret-interne");
    expect(message).not.toContain("mot-de-passe");
    expect(message).not.toContain("8000");
  });

  it.each(["ftp://api:8000", "file:///etc/passwd", "javascript:alert(1)"])(
    "refuse le schéma d'URL %s",
    async (valeur) => {
      /* `z.url()` seul ne contraint pas le protocole. Le schéma est borné à http/https :
         la cible de `apiFetch` ne doit pas pouvoir devenir autre chose qu'une API HTTP. */
      process.env.API_INTERNAL_URL = valeur;

      const { serverEnv } = await chargerEnv();

      expect(() => serverEnv()).toThrow(/API_INTERNAL_URL/);
    },
  );

  it("met le résultat en cache : une variable modifiée après le premier appel est ignorée", async () => {
    process.env.API_INTERNAL_URL = "http://api:8000";

    const { serverEnv } = await chargerEnv();
    const premier = serverEnv();

    process.env.API_INTERNAL_URL = "http://autre-hote:9000";
    const second = serverEnv();

    expect(second).toBe(premier);
    expect(second.API_INTERNAL_URL).toBe("http://api:8000");
  });

  it("ne met pas en cache un échec : la lecture est retentée au second appel", async () => {
    const { serverEnv } = await chargerEnv();

    expect(() => serverEnv()).toThrow();

    process.env.API_INTERNAL_URL = VALEUR_SENSIBLE;
    expect(serverEnv().API_INTERNAL_URL).toBe(VALEUR_SENSIBLE);
  });

  it("n'expose rien sous un nom préfixé NEXT_PUBLIC_ (§3 : le navigateur ignore Django)", async () => {
    process.env.API_INTERNAL_URL = VALEUR_SENSIBLE;

    const { serverEnv } = await chargerEnv();

    expect(Object.keys(serverEnv()).some((cle) => cle.startsWith("NEXT_PUBLIC_"))).toBe(false);
  });
});

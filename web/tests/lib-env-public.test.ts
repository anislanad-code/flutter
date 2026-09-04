import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function chargerEnv() {
  vi.resetModules();
  return await import("@/lib/env-public");
}

const environnementInitial = { ...process.env };

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  process.env = { ...environnementInitial };
});

describe("serverEnv() public", () => {
  it("renvoie l'URL du site quand elle est présente et valide", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://anis.dev";

    const { serverEnv } = await chargerEnv();

    expect(serverEnv()).toEqual({ NEXT_PUBLIC_SITE_URL: "https://anis.dev" });
  });

  it("retombe sur une valeur de développement quand la variable est absente", async () => {
    const { serverEnv } = await chargerEnv();

    expect(serverEnv()).toEqual({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" });
  });

  it("échoue quand la variable n'est pas une URL http(s)", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "ftp://anis.dev";

    const { serverEnv } = await chargerEnv();

    expect(() => serverEnv()).toThrow();
  });

  it("met le résultat en cache", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://anis.dev";

    const { serverEnv } = await chargerEnv();
    const premier = serverEnv();

    process.env.NEXT_PUBLIC_SITE_URL = "https://autre.example";
    expect(serverEnv()).toBe(premier);
  });
});

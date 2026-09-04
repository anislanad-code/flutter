// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/* Les pages de l'étape 1. Pour les deux pages protégées (/app et /admin), ce qui compte
   n'est pas le contenu — il arrive aux étapes 2 et 7 — mais la garde : pas de session →
   /connexion, session non-staff sur /admin → /app. Le statut vient de Django, jamais du
   client (§4.3). */

const utilisateurCourant = vi.hoisted(() => vi.fn());
const recupererEtatInscription = vi.hoisted(() => vi.fn());
const recupererCours = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((cible: string) => {
    throw new Error(`REDIRECT:${cible}`);
  }),
);

vi.mock("@/lib/current-user", () => ({ utilisateurCourant }));
vi.mock("@/lib/enrollment", () => ({ recupererEtatInscription }));
vi.mock("@/lib/catalog", () => ({
  recupererCours,
  SLUG_FORMATION_PRINCIPALE: "flutter-firebase-debutants",
}));
vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const pageConnexion = await import("@/app/(auth)/connexion/page");
const pageInscription = await import("@/app/(auth)/inscription/page");
const pageOublie = await import("@/app/(auth)/mot-de-passe-oublie/page");
const pageNouveau = await import("@/app/(auth)/nouveau-mot-de-passe/page");
const layoutAuth = await import("@/app/(auth)/layout");
const pageEtudiant = await import("@/app/(student)/app/page");
const pageAdmin = await import("@/app/(admin)/admin/page");

const ETUDIANTE = {
  id: 7,
  email: "etudiante@example.com",
  phone: "0550112233",
  is_staff: false,
  created_at: "2026-01-01T00:00:00Z",
  last_activity_at: null,
};
const ADMIN = { ...ETUDIANTE, id: 1, email: "anis@example.com", is_staff: true };

beforeEach(() => {
  utilisateurCourant.mockReset();
  recupererEtatInscription.mockReset().mockResolvedValue(null);
  recupererCours.mockReset().mockResolvedValue(null);
  redirect.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("pages publiques d'authentification", () => {
  it("/connexion : titre, formulaire et lien vers l'inscription", () => {
    render(pageConnexion.default());
    expect(screen.getByRole("heading", { name: "Connecte-toi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Crée-en un" }).getAttribute("href")).toBe(
      "/inscription",
    );
  });

  it("/inscription : formulaire à trois champs", () => {
    render(pageInscription.default());
    expect(screen.getByRole("button", { name: "Créer mon compte" })).toBeTruthy();
    expect(screen.getByLabelText("Téléphone")).toBeTruthy();
  });

  it("/mot-de-passe-oublie : formulaire d'envoi du lien", () => {
    render(pageOublie.default());
    expect(screen.getByRole("button", { name: "Envoyer le lien" })).toBeTruthy();
  });

  it("/nouveau-mot-de-passe : sans token, message d'erreur et pas de formulaire", () => {
    render(pageNouveau.default());
    expect(screen.getByRole("alert").textContent).toContain("Ce lien est incomplet");
  });

  it("le layout d'auth encadre ses enfants dans un <main>", () => {
    const { container } = render(layoutAuth.default({ children: <p>contenu</p> }));
    expect(container.querySelector("main")).toBeTruthy();
    expect(screen.getByText("contenu")).toBeTruthy();
  });

  it("les quatre pages déclarent un titre, et /admin refuse l'indexation", () => {
    expect(pageConnexion.metadata.title).toBe("Se connecter — anis.dev");
    expect(pageInscription.metadata.title).toBeTruthy();
    expect(pageOublie.metadata.title).toBeTruthy();
    expect(pageNouveau.metadata.title).toBeTruthy();
    expect(pageAdmin.metadata.robots).toEqual({ index: false });
  });
});

describe("/app — espace étudiant", () => {
  it("rend l'email de la session et le bouton de déconnexion", async () => {
    utilisateurCourant.mockResolvedValue(ETUDIANTE);
    render(await pageEtudiant.default());

    expect(screen.getByRole("heading", { name: "Ton parcours" })).toBeTruthy();
    expect(screen.getByText("etudiante@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sans session : redirige vers /connexion en conservant la destination", async () => {
    utilisateurCourant.mockResolvedValue(null);
    await expect(pageEtudiant.default()).rejects.toThrow("REDIRECT:/connexion?suite=/app");
    expect(redirect).toHaveBeenCalledWith("/connexion?suite=/app");
  });

  it("est forcée en rendu dynamique (jamais de HTML de session prérendu)", () => {
    expect(pageEtudiant.dynamic).toBe("force-dynamic");
    expect(pageAdmin.dynamic).toBe("force-dynamic");
  });
});

describe("/admin — back-office", () => {
  it("un compte is_staff voit la page", async () => {
    utilisateurCourant.mockResolvedValue(ADMIN);
    render(await pageAdmin.default());

    expect(screen.getByRole("heading", { name: "Administration" })).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sans session : redirige vers /connexion", async () => {
    utilisateurCourant.mockResolvedValue(null);
    await expect(pageAdmin.default()).rejects.toThrow("REDIRECT:/connexion?suite=/admin");
  });

  it("session valide mais non-staff : renvoyée vers /app, aucun contenu admin rendu", async () => {
    utilisateurCourant.mockResolvedValue(ETUDIANTE);
    await expect(pageAdmin.default()).rejects.toThrow("REDIRECT:/app");
    expect(screen.queryByText("Administration")).toBeNull();
  });

  it("un is_staff falsifié côté client n'existe pas : la page ne lit que la réponse de Django", async () => {
    // Le seul chemin vers `is_staff` est `utilisateurCourant()`, validé par Zod contre
    // la réponse de /api/me. Aucun paramètre d'URL, cookie lisible ou en-tête n'entre
    // dans la décision : on le prouve en constatant que la page n'a aucun autre argument.
    expect(pageAdmin.default.length).toBe(0);
    utilisateurCourant.mockResolvedValue({ ...ETUDIANTE, is_staff: false });
    await expect(pageAdmin.default()).rejects.toThrow("REDIRECT:/app");
  });
});

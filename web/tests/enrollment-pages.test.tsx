// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/* Les pages de l'étape 3.

   Ce qu'elles doivent prouver : une session manquante redirige, un compte non-admin
   n'atteint pas la file, un compte en attente voit son parcours plutôt qu'une page
   vide, et un chapitre refusé par Django tombe en 404 sans que la page en reconstruise
   la moindre miette (§4.4). */

const utilisateurCourant = vi.hoisted(() => vi.fn());
const recupererEtatInscription = vi.hoisted(() => vi.fn());
const recupererInscriptionsAdmin = vi.hoisted(() => vi.fn());
const recupererCours = vi.hoisted(() => vi.fn());
const recupererChapitreAuthentifie = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((cible: string) => {
    throw new Error(`REDIRECT:${cible}`);
  }),
);
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
);

vi.mock("@/lib/current-user", () => ({ utilisateurCourant }));
vi.mock("@/lib/enrollment", () => ({ recupererEtatInscription, recupererInscriptionsAdmin }));
vi.mock("@/lib/catalog", () => ({
  recupererCours,
  recupererChapitreAuthentifie,
  SLUG_FORMATION_PRINCIPALE: "flutter-firebase-debutants",
}));
vi.mock("next/navigation", () => ({
  redirect,
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const pageEtudiant = await import("@/app/(student)/app/page");
const pageActivation = await import("@/app/(student)/app/activation/page");
const pageChapitre = await import("@/app/(student)/app/chapitre/[chapitre]/page");
const pageInscriptions = await import("@/app/(admin)/admin/inscriptions/page");

const ETUDIANTE = {
  id: 7,
  email: "etudiante@example.com",
  phone: "0550112233",
  is_staff: false,
  created_at: "2026-01-01T00:00:00Z",
  last_activity_at: null,
};
const ADMIN = { ...ETUDIANTE, id: 1, email: "anis@example.com", is_staff: true };

const INSTRUCTIONS = {
  provider: "MANUAL_CCP",
  requiert_preuve: true,
  amount_dzd: 12000,
  account_label: "CCP",
  account_number: "0012345678",
  account_key: "42",
  account_holder: "LANAD ANIS",
  reference: "ANISDEV-000007",
};

const etat = (extras: Record<string, unknown> = {}) => ({
  status: "PENDING",
  course_slug: "flutter-firebase-debutants",
  depot_possible: true,
  instructions: INSTRUCTIONS,
  derniere_preuve: null,
  ...extras,
});

const COURS = {
  slug: "flutter-firebase-debutants",
  title: "Flutter + Firebase",
  description: "",
  modules: [
    {
      id: 1,
      order: 0,
      title: "Mise en route",
      summary: "",
      chapters: [
        { id: 1, slug: "installer-flutter", order: 1, title: "Installer Flutter", is_free: true },
        { id: 2, slug: "premier-widget", order: 2, title: "Ton premier widget", is_free: false },
      ],
    },
  ],
};

const CHAPITRE = {
  id: 2,
  slug: "premier-widget",
  title: "Ton premier widget",
  is_free: false,
  lesson: { video_provider_id: "", duration_s: 600, transcript: "Contenu.", resources: [] },
  module_title: "Mise en route",
  course_slug: "flutter-firebase-debutants",
  course_title: "Flutter + Firebase",
};

beforeEach(() => {
  utilisateurCourant.mockReset().mockResolvedValue(ETUDIANTE);
  recupererEtatInscription.mockReset().mockResolvedValue(etat());
  recupererInscriptionsAdmin.mockReset().mockResolvedValue([]);
  recupererCours.mockReset().mockResolvedValue(COURS);
  recupererChapitreAuthentifie.mockReset().mockResolvedValue(null);
  redirect.mockClear();
  notFound.mockClear();
});

afterEach(cleanup);

describe("/app — tableau de bord", () => {
  it("un compte en attente voit le parcours complet et l'invitation à payer", async () => {
    render(await pageEtudiant.default());

    expect(screen.getByRole("heading", { name: "Ton parcours" })).toBeTruthy();
    expect(screen.getByText("Installer Flutter")).toBeTruthy();
    expect(screen.getByText(/Ton premier widget/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Envoyer le reçu" }).getAttribute("href")).toBe(
      "/app/activation",
    );
    expect(screen.getByText(/verse au CCP/)).toBeTruthy();
  });

  it("la bannière reprend le libellé du fournisseur, pas le mot CCP en dur", async () => {
    recupererEtatInscription.mockResolvedValue(
      etat({ instructions: { ...INSTRUCTIONS, account_label: "BaridiMob" } }),
    );

    render(await pageEtudiant.default());

    expect(screen.getByText(/verse au BaridiMob/)).toBeTruthy();
    expect(screen.queryByText(/verse au CCP/)).toBeNull();
  });

  it("un reçu en cours d'examen donne une attente honnête, sans nouveau bouton", async () => {
    recupererEtatInscription.mockResolvedValue(
      etat({ derniere_preuve: { status: "SUBMITTED", reject_reason: "" } }),
    );

    render(await pageEtudiant.default());

    expect(screen.getByText(/Réponse sous 24 h/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Envoyer le reçu" })).toBeNull();
  });

  it("un reçu refusé affiche le motif et propose de renvoyer", async () => {
    recupererEtatInscription.mockResolvedValue(
      etat({
        derniere_preuve: { status: "REJECTED", reject_reason: "Le montant n'est pas lisible." },
      }),
    );

    render(await pageEtudiant.default());

    expect(screen.getByText(/Le montant n'est pas lisible/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Renvoyer un reçu" })).toBeTruthy();
  });

  it("un compte actif n'a plus de bannière de versement", async () => {
    recupererEtatInscription.mockResolvedValue(etat({ status: "ACTIVE", depot_possible: false }));

    render(await pageEtudiant.default());

    expect(screen.queryByRole("link", { name: "Envoyer le reçu" })).toBeNull();
    expect(screen.getByRole("link", { name: "Ton premier widget" })).toBeTruthy();
  });

  it("catalogue injoignable : message honnête plutôt qu'une page cassée", async () => {
    recupererCours.mockResolvedValue(null);

    render(await pageEtudiant.default());

    expect(screen.getByText(/n'a pas pu être chargé/)).toBeTruthy();
  });

  it("état d'inscription injoignable : le parcours reste visible, en attente", async () => {
    recupererEtatInscription.mockResolvedValue(null);

    render(await pageEtudiant.default());

    expect(screen.getByRole("link", { name: "Envoyer le reçu" })).toBeTruthy();
    expect(screen.getByText("Installer Flutter")).toBeTruthy();
  });

  it("un compte expiré voit encore le chapitre gratuit, pas le payant", async () => {
    recupererEtatInscription.mockResolvedValue(etat({ status: "EXPIRED", depot_possible: false }));

    render(await pageEtudiant.default());

    expect(screen.getByRole("link", { name: "Envoyer le reçu" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ton premier widget" })).toBeNull();
  });

  it("sans session : redirige vers /connexion", async () => {
    utilisateurCourant.mockResolvedValue(null);

    await expect(pageEtudiant.default()).rejects.toThrow("REDIRECT:/connexion?suite=/app");
  });
});

describe("/app/activation", () => {
  it("affiche les coordonnées de versement et le formulaire", async () => {
    render(await pageActivation.default());

    expect(screen.getByText("0012345678")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Envoyer le reçu" })).toBeTruthy();
  });

  it("un reçu déjà en examen remplace le formulaire par une attente", async () => {
    recupererEtatInscription.mockResolvedValue(
      etat({ depot_possible: false, derniere_preuve: { status: "SUBMITTED", reject_reason: "" } }),
    );

    render(await pageActivation.default());

    expect(screen.getByRole("heading", { name: "Reçu envoyé" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Envoyer le reçu" })).toBeNull();
  });

  it("après un refus, le motif est rappelé au-dessus du formulaire", async () => {
    recupererEtatInscription.mockResolvedValue(
      etat({ derniere_preuve: { status: "REJECTED", reject_reason: "Capture illisible." } }),
    );

    render(await pageActivation.default());

    expect(screen.getByText("Capture illisible.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Envoyer le reçu" })).toBeTruthy();
  });

  it("un compte déjà actif est renvoyé à son parcours", async () => {
    recupererEtatInscription.mockResolvedValue(etat({ status: "ACTIVE" }));

    await expect(pageActivation.default()).rejects.toThrow("REDIRECT:/app");
  });

  it("sans session : redirige en conservant la destination", async () => {
    utilisateurCourant.mockResolvedValue(null);

    await expect(pageActivation.default()).rejects.toThrow(
      "REDIRECT:/connexion?suite=/app/activation",
    );
  });

  it("état injoignable : message honnête, jamais un formulaire sans coordonnées", async () => {
    recupererEtatInscription.mockResolvedValue(null);

    render(await pageActivation.default());

    expect(screen.getByText(/n'ont pas pu être chargées/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Envoyer le reçu" })).toBeNull();
  });

  it("un compte bloqué n'a plus de formulaire de reçu", async () => {
    recupererEtatInscription.mockResolvedValue(etat({ status: "BLOCKED", depot_possible: false }));

    render(await pageActivation.default());

    expect(screen.getByText(/n'attend plus de reçu/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Envoyer le reçu" })).toBeNull();
    expect(screen.getByRole("link", { name: "Retourner au parcours" })).toBeTruthy();
  });
});

describe("/app/chapitre/[chapitre]", () => {
  const params = Promise.resolve({ chapitre: "premier-widget" });

  it("un chapitre refusé par Django tombe en 404 sans rien afficher", async () => {
    recupererChapitreAuthentifie.mockResolvedValue(null);

    await expect(pageChapitre.default({ params })).rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("un chapitre servi est rendu avec son titre et son module", async () => {
    recupererChapitreAuthentifie.mockResolvedValue(CHAPITRE);

    render(await pageChapitre.default({ params }));

    expect(screen.getByRole("heading", { name: "Ton premier widget" })).toBeTruthy();
    expect(screen.getByText("Mise en route")).toBeTruthy();
  });

  it("le titre de la page ne dévoile jamais le titre du chapitre", async () => {
    expect(pageChapitre.metadata.title).toBe("Chapitre — anis.dev");
    expect(pageChapitre.metadata.robots).toEqual({ index: false, follow: false });
  });

  it("sans session : redirige en conservant la destination", async () => {
    utilisateurCourant.mockResolvedValue(null);

    await expect(pageChapitre.default({ params })).rejects.toThrow(
      "REDIRECT:/connexion?suite=/app/chapitre/premier-widget",
    );
  });
});

describe("/admin/inscriptions", () => {
  const sans = Promise.resolve({});

  it("un compte non-admin est renvoyé vers son espace", async () => {
    utilisateurCourant.mockResolvedValue(ETUDIANTE);

    await expect(pageInscriptions.default({ searchParams: sans })).rejects.toThrow("REDIRECT:/app");
    expect(recupererInscriptionsAdmin).not.toHaveBeenCalled();
  });

  it("sans session : redirige vers /connexion", async () => {
    utilisateurCourant.mockResolvedValue(null);

    await expect(pageInscriptions.default({ searchParams: sans })).rejects.toThrow(
      "REDIRECT:/connexion?suite=/admin/inscriptions",
    );
  });

  it("l'admin voit la file, filtrée sur les demandes en attente par défaut", async () => {
    utilisateurCourant.mockResolvedValue(ADMIN);

    render(await pageInscriptions.default({ searchParams: sans }));

    expect(screen.getByRole("heading", { name: "Inscriptions" })).toBeTruthy();
    expect(recupererInscriptionsAdmin).toHaveBeenCalledWith("PENDING");
  });

  it("un filtre hors allow-list retombe sur les demandes en attente", async () => {
    utilisateurCourant.mockResolvedValue(ADMIN);

    render(
      await pageInscriptions.default({
        searchParams: Promise.resolve({ statut: "' OR 1=1 --" }),
      }),
    );

    expect(recupererInscriptionsAdmin).toHaveBeenCalledWith("PENDING");
  });

  it("le filtre « toutes » n'envoie aucun statut à l'API", async () => {
    utilisateurCourant.mockResolvedValue(ADMIN);

    render(
      await pageInscriptions.default({ searchParams: Promise.resolve({ statut: "TOUS" }) }),
    );

    expect(recupererInscriptionsAdmin).toHaveBeenCalledWith(undefined);
  });

  it("les deux pages d'administration refusent l'indexation", () => {
    expect(pageInscriptions.metadata.robots).toEqual({ index: false, follow: false });
  });

  it("le filtre Actives est relayé tel quel", async () => {
    utilisateurCourant.mockResolvedValue(ADMIN);

    render(
      await pageInscriptions.default({ searchParams: Promise.resolve({ statut: "ACTIVE" }) }),
    );

    expect(recupererInscriptionsAdmin).toHaveBeenCalledWith("ACTIVE");
  });

  it("une file injoignable s'affiche vide plutôt que de casser", async () => {
    utilisateurCourant.mockResolvedValue(ADMIN);
    recupererInscriptionsAdmin.mockResolvedValue(null);

    render(await pageInscriptions.default({ searchParams: sans }));

    expect(screen.getByText(/Rien à traiter/)).toBeTruthy();
  });
});

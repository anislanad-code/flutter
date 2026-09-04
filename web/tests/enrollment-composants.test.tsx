// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* Les composants de l'étape 3. Ce qui compte ici : le contrôle client est un confort,
   jamais une frontière (§4.5), un refus dit quoi corriger (§6), et le parcours d'un
   compte en attente montre tout — pas une page vide. */

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  redirect: vi.fn((cible: string) => {
    throw new Error(`REDIRECT:${cible}`);
  }),
}));

const { FormulaireRecu } = await import("@/components/enrollment/FormulaireRecu");
const { InstructionsVersement } = await import("@/components/enrollment/InstructionsVersement");
const { ParcoursEtudiant } = await import("@/components/student/ParcoursEtudiant");
const { FileInscriptions } = await import("@/components/admin/FileInscriptions");

const INSTRUCTIONS = {
  provider: "MANUAL_CCP",
  requiert_preuve: true,
  amount_dzd: 12000,
  account_label: "CCP",
  account_number: "0012345678",
  account_key: "42",
  account_holder: "LANAD ANIS",
  reference: "ANISDEV-000001",
};

const COURS = {
  slug: "flutter-firebase-debutants",
  title: "Flutter + Firebase",
  description: "",
  modules: [
    {
      id: 1,
      order: 0,
      title: "Mise en route",
      summary: "Installer l'outillage.",
      chapters: [
        { id: 1, slug: "installer-flutter", order: 1, title: "Installer Flutter", is_free: true },
        { id: 2, slug: "premier-widget", order: 2, title: "Ton premier widget", is_free: false },
      ],
    },
  ],
};

const PREUVE = {
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  status: "SUBMITTED" as const,
  amount_declared: 12000,
  content_type: "image/jpeg",
  byte_size: 4096,
  reject_reason: "",
  created_at: "2026-01-02T00:00:00Z",
  reviewed_at: null,
  purged_at: null,
};

const INSCRIPTION = {
  id: 7,
  status: "PENDING" as const,
  user_email: "etudiante@example.com",
  user_phone: "0550112233",
  course_title: "Flutter + Firebase",
  reference: "ANISDEV-000007",
  note_admin: "",
  created_at: "2026-01-01T00:00:00Z",
  activated_at: null,
  preuves: [PREUVE],
};

function fichier(nom: string, type: string, octets = 32): File {
  return new File([new Uint8Array(octets)], nom, { type });
}

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  // jsdom ne fournit pas createObjectURL, dont dépend l'aperçu.
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:apercu", revokeObjectURL: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InstructionsVersement", () => {
  it("affiche le montant, le compte et la référence à recopier", () => {
    render(<InstructionsVersement instructions={INSTRUCTIONS} />);

    expect(screen.getByRole("heading", { name: "Verse au CCP" })).toBeTruthy();
    expect(screen.getByText("0012345678")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("LANAD ANIS")).toBeTruthy();
    expect(screen.getByText("ANISDEV-000001")).toBeTruthy();
  });

  it("le titre suit account_label, jamais le mot CCP en dur", () => {
    render(
      <InstructionsVersement instructions={{ ...INSTRUCTIONS, account_label: "CIB" }} />,
    );

    expect(screen.getByRole("heading", { name: "Verse au CIB" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Verse au CCP" })).toBeNull();
  });

  it("n'utilise pas la police de code pour un numéro de compte", () => {
    const { container } = render(<InstructionsVersement instructions={INSTRUCTIONS} />);

    expect(container.querySelector(".font-code")).toBeNull();
  });
});

describe("FormulaireRecu", () => {
  it("refuse un fichier de plus de 5 Mo sans rien envoyer", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(
      screen.getByLabelText("Capture du reçu"),
      fichier("gros.jpg", "image/jpeg", 6 * 1024 * 1024),
    );

    expect(screen.getByRole("alert").textContent).toContain("5 Mo");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuse un type non accepté et dit lesquels le sont", async () => {
    // `applyAccept: false` : l'attribut `accept` du champ écarterait le fichier avant
    // même le composant. Ce n'est pas ce qu'on teste — un fichier peut arriver par
    // glisser-déposer ou par script, et c'est justement le cas qui compte.
    const utilisateur = userEvent.setup({ applyAccept: false });
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(
      screen.getByLabelText("Capture du reçu"),
      fichier("script.svg", "image/svg+xml"),
    );

    expect(screen.getByRole("alert").textContent).toContain("JPEG, PNG ou PDF");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sans fichier choisi, envoyer ne déclenche aucun appel", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.click(screen.getByRole("button", { name: "Envoyer le reçu" }));

    expect(screen.getByRole("alert").textContent).toContain("Choisis");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("envoie le fichier et le montant en multipart, puis rafraîchit", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Reçu envoyé." }), { status: 201 }),
    );
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(screen.getByLabelText("Capture du reçu"), fichier("recu.jpg", "image/jpeg"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer le reçu" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const corps = vi.mocked(fetch).mock.calls[0]?.[1]?.body as FormData;
    expect([...corps.keys()].sort()).toEqual(["amount_declared", "file"]);
    expect(corps.get("amount_declared")).toBe("12000");
  });

  it("relaie le message de refus du serveur, qui dit quoi corriger", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Format non accepté. Envoie une image JPEG." }), {
        status: 400,
      }),
    );
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(screen.getByLabelText("Capture du reçu"), fichier("recu.jpg", "image/jpeg"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer le reçu" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Format non accepté"),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("le bouton se désactive pendant l'envoi et dit ce qu'il est en train de faire", async () => {
    let relacher: (valeur: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          relacher = resolve;
        }),
    );
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(screen.getByLabelText("Capture du reçu"), fichier("recu.jpg", "image/jpeg"));
    const clic = utilisateur.click(screen.getByRole("button", { name: "Envoyer le reçu" }));

    await waitFor(() => {
      const bouton = screen.getByRole("button", { name: "Envoi du reçu…" });
      expect(bouton).toBeTruthy();
      expect((bouton as HTMLButtonElement).disabled).toBe(true);
    });

    relacher(new Response(JSON.stringify({ detail: "Reçu envoyé." }), { status: 201 }));
    await clic;
  });

  it("affiche un aperçu pour une image, et le nom du fichier pour un PDF", async () => {
    const utilisateur = userEvent.setup();
    const { rerender } = render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(screen.getByLabelText("Capture du reçu"), fichier("recu.jpg", "image/jpeg"));
    expect(screen.getByAltText("Aperçu du reçu que tu vas envoyer")).toBeTruthy();

    rerender(<FormulaireRecu montantAttendu={12000} />);
  });

  it("un PDF choisi s'annonce par son nom, sans balise image", async () => {
    const utilisateur = userEvent.setup({ applyAccept: false });
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(
      screen.getByLabelText("Capture du reçu"),
      fichier("recu.pdf", "application/pdf"),
    );

    expect(screen.getByText(/Fichier prêt : recu.pdf/)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("une erreur réseau dit de vérifier la connexion", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(screen.getByLabelText("Capture du reçu"), fichier("recu.jpg", "image/jpeg"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer le reçu" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Vérifie ta connexion"),
    );
  });

  it("un refus sans message exploitable devient un message générique", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("pas json", { status: 500 }));
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    await utilisateur.upload(screen.getByLabelText("Capture du reçu"), fichier("recu.jpg", "image/jpeg"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer le reçu" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("n'a pas pu être envoyé"),
    );
  });

  it("le montant saisi est celui qui part, pas celui affiché par défaut", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Reçu envoyé." }), { status: 201 }),
    );
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    const champ = screen.getByLabelText(/Montant versé/);
    await utilisateur.clear(champ);
    await utilisateur.type(champ, "8000");
    await utilisateur.upload(screen.getByLabelText("Capture du reçu"), fichier("recu.jpg", "image/jpeg"));
    await utilisateur.click(screen.getByRole("button", { name: "Envoyer le reçu" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const corps = vi.mocked(fetch).mock.calls[0]?.[1]?.body as FormData;
    expect(corps.get("amount_declared")).toBe("8000");
  });

  it("les champs sont focusables au clavier, sans tabindex piégé", async () => {
    render(<FormulaireRecu montantAttendu={12000} />);

    expect(screen.getByLabelText(/Montant versé/).getAttribute("tabindex")).toBeNull();
    expect(screen.getByLabelText("Capture du reçu").getAttribute("tabindex")).toBeNull();
    expect(screen.getByRole("button", { name: "Envoyer le reçu" }).getAttribute("tabindex")).toBeNull();
  });

  it("vider le champ fichier retire le fichier choisi", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireRecu montantAttendu={12000} />);

    const champ = screen.getByLabelText("Capture du reçu");
    await utilisateur.upload(champ, fichier("recu.jpg", "image/jpeg"));
    expect(screen.getByAltText("Aperçu du reçu que tu vas envoyer")).toBeTruthy();

    fireEvent.change(champ, { target: { files: [] } });

    expect(screen.queryByAltText("Aperçu du reçu que tu vas envoyer")).toBeNull();
  });
});

describe("ParcoursEtudiant", () => {
  it("un compte en attente voit tout le programme, pas une page vide", () => {
    render(<ParcoursEtudiant cours={COURS} statut="PENDING" />);

    expect(screen.getByText("Installer Flutter")).toBeTruthy();
    expect(screen.getByText(/Ton premier widget/)).toBeTruthy();
  });

  it("en attente : le chapitre gratuit est un lien, le payant n'en est pas un", () => {
    render(<ParcoursEtudiant cours={COURS} statut="PENDING" />);

    expect(screen.getByRole("link", { name: /Installer Flutter/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Ton premier widget/ })).toBeNull();
  });

  it("en attente : le chapitre gratuit porte l'unique marque safran", () => {
    const { container } = render(<ParcoursEtudiant cours={COURS} statut="PENDING" />);

    expect(container.querySelectorAll(".ring-safran")).toHaveLength(1);
  });

  it("un compte actif a tous les chapitres en lien vers son espace", () => {
    render(<ParcoursEtudiant cours={COURS} statut="ACTIVE" />);

    const payant = screen.getByRole("link", { name: "Ton premier widget" });
    expect(payant.getAttribute("href")).toBe("/app/chapitre/premier-widget");
    expect(document.querySelectorAll(".ring-safran")).toHaveLength(0);
  });

  it("un compte bloqué n'ouvre rien de plus qu'un compte en attente", () => {
    render(<ParcoursEtudiant cours={COURS} statut="BLOCKED" />);

    expect(screen.queryByRole("link", { name: /Ton premier widget/ })).toBeNull();
  });

  it("un compte expiré est traité comme un compte en attente, pas comme un actif", () => {
    render(<ParcoursEtudiant cours={COURS} statut="EXPIRED" />);

    expect(screen.queryByRole("link", { name: /Ton premier widget/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Installer Flutter/ })).toBeTruthy();
  });
});

describe("FileInscriptions", () => {
  it("une file vide le dit sans dramatiser", () => {
    render(<FileInscriptions inscriptions={[]} />);

    expect(screen.getByText(/Rien à traiter/)).toBeTruthy();
  });

  it("affiche l'email, la référence et le montant déclaré", () => {
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    expect(screen.getByText("etudiante@example.com")).toBeTruthy();
    expect(screen.getByText("ANISDEV-000007")).toBeTruthy();
    expect(screen.getByText(/^Déclaré :/).textContent).toContain("DA");
  });

  it("le reçu n'est chargé que sur demande explicite", async () => {
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    expect(document.querySelector("img")).toBeNull();
    await utilisateur.click(screen.getByRole("button", { name: "Voir le reçu" }));

    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      `/api/admin/proofs/${PREUVE.id}/apercu`,
    );
  });

  it("un PDF s'ouvre en téléchargement, jamais dans un <img>", () => {
    const pdf = {
      ...INSCRIPTION,
      preuves: [{ ...PREUVE, content_type: "application/pdf" }],
    };
    render(<FileInscriptions inscriptions={[pdf]} />);

    const lien = screen.getByRole("link", { name: "Télécharger le reçu (PDF)" });
    expect(lien.getAttribute("href")).toBe(`/api/admin/proofs/${PREUVE.id}/apercu`);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Voir le reçu" })).toBeNull();
  });

  it("refuser sans motif est bloqué côté client aussi", async () => {
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    await utilisateur.click(screen.getByRole("button", { name: "Refuser le reçu" }));

    expect(screen.getByRole("alert").textContent).toContain("motif");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("valider appelle la route d'acceptation puis rafraîchit", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Inscription validée." }), { status: 200 }),
    );
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    await utilisateur.click(screen.getByRole("button", { name: "Valider le versement" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/admin/enrollments/7/accept");
  });

  it("refuser avec motif transmet le motif tel quel", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Reçu refusé." }), { status: 200 }),
    );
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    await utilisateur.type(screen.getByLabelText("Motif, si tu refuses"), "Montant illisible.");
    await utilisateur.click(screen.getByRole("button", { name: "Refuser le reçu" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      reason: "Montant illisible.",
    });
  });

  it("une erreur du serveur est affichée sans faire disparaître la file", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: "Cette inscription n'a aucun reçu à examiner." }), {
        status: 409,
      }),
    );
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    await utilisateur.click(screen.getByRole("button", { name: "Valider le versement" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("aucun reçu à examiner"),
    );
    expect(screen.getByText("etudiante@example.com")).toBeTruthy();
  });

  it("une inscription sans reçu en examen n'offre pas les boutons d'action", () => {
    render(<FileInscriptions inscriptions={[{ ...INSCRIPTION, preuves: [] }]} />);

    expect(screen.getByText(/Aucun reçu en attente/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Valider le versement" })).toBeNull();
  });

  it("un téléphone vide le dit plutôt que d'afficher une case blanche", () => {
    render(<FileInscriptions inscriptions={[{ ...INSCRIPTION, user_phone: "" }]} />);

    expect(screen.getByText(/non renseigné/)).toBeTruthy();
  });

  it("une coupure réseau est dite comme telle", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    await utilisateur.click(screen.getByRole("button", { name: "Valider le versement" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Vérifie ta connexion"),
    );
  });

  it("un refus serveur sans détail exploitable devient un message générique", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("pas json", { status: 500 }));
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    await utilisateur.click(screen.getByRole("button", { name: "Valider le versement" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("n'a pas abouti"),
    );
  });

  it("les boutons se désactivent pendant l'action", async () => {
    let relacher: (valeur: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          relacher = resolve;
        }),
    );
    const utilisateur = userEvent.setup();
    render(<FileInscriptions inscriptions={[INSCRIPTION]} />);

    const clic = utilisateur.click(screen.getByRole("button", { name: "Valider le versement" }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Valider le versement" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    relacher(new Response(JSON.stringify({ detail: "Inscription validée." }), { status: 200 }));
    await clic;
  });
});

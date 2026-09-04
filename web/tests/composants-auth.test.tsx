// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* Les quatre formulaires d'auth et le bouton de déconnexion. Pour chacun : rendu,
   saisie valide, saisie invalide avec message, état de chargement, état d'erreur
   réseau, et navigation au clavier de bout en bout (§6, plancher de qualité). */

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const parametres = vi.hoisted(() => new URLSearchParams());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => parametres,
}));

const { ChampTexte } = await import("@/components/auth/ChampTexte");
const { FormulaireConnexion } = await import("@/components/auth/FormulaireConnexion");
const { FormulaireInscription } = await import("@/components/auth/FormulaireInscription");
const { FormulaireMotDePasseOublie } = await import(
  "@/components/auth/FormulaireMotDePasseOublie"
);
const { FormulaireNouveauMotDePasse } = await import(
  "@/components/auth/FormulaireNouveauMotDePasse"
);
const { BoutonDeconnexion } = await import("@/components/auth/BoutonDeconnexion");

/** Une réponse qui ne se résout que sur demande : sert à observer l'état de chargement. */
function reponseSuspendue() {
  let liberer!: (reponse: Response) => void;
  const promesse = new Promise<Response>((resolve) => {
    liberer = resolve;
  });
  return { promesse, liberer };
}

function reponse(status: number, corps: unknown = {}): Response {
  const sansCorps = status === 204 || status === 205 || status === 304;
  return new Response(sansCorps ? null : JSON.stringify(corps), {
    status,
    headers: sansCorps ? undefined : { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

/** L'appel `fetch` du composant : URL et corps JSON, sans indexation non typée. */
function appelFetch(index = 0): { url: string; init: RequestInit; corps: unknown } {
  const appel = fetchMock.mock.calls.at(index);
  if (!appel) throw new Error("fetch n'a pas été appelé");
  const init = (appel[1] ?? {}) as RequestInit;
  return {
    url: String(appel[0]),
    init,
    corps: init.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  for (const cle of [...parametres.keys()]) parametres.delete(cle);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChampTexte", () => {
  it("relie le label à l'input et remonte la saisie", async () => {
    const onChange = vi.fn();
    render(<ChampTexte id="email" label="Email" value="" onChange={onChange} />);

    const input = screen.getByLabelText("Email");
    expect(input).toHaveProperty("required", true);
    expect(input.getAttribute("aria-invalid")).toBeNull();

    await userEvent.type(input, "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("annonce l'erreur en aria-invalid + aria-describedby", () => {
    render(
      <ChampTexte
        id="password"
        label="Mot de passe"
        value="court"
        onChange={vi.fn()}
        erreur="Au moins 10 caractères."
        requis={false}
      />,
    );

    const input = screen.getByLabelText("Mot de passe");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("password-erreur");
    expect(screen.getByText("Au moins 10 caractères.").id).toBe("password-erreur");
    expect(input).toHaveProperty("required", false);
  });
});

describe("FormulaireConnexion", () => {
  it("rend les deux champs et le bouton", () => {
    render(<FormulaireConnexion />);
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Mot de passe")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeTruthy();
  });

  it("chemin nominal : poste les identifiants puis redirige vers /app", async () => {
    fetchMock.mockResolvedValue(reponse(200));
    render(<FormulaireConnexion />);

    await userEvent.type(screen.getByLabelText("Email"), "etudiante@example.com");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "motdepasse-long");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    const { url, init, corps } = appelFetch();
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(corps).toEqual({
      email: "etudiante@example.com",
      password: "motdepasse-long",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("suit ?suite= quand c'est un chemin interne", async () => {
    parametres.set("suite", "/admin");
    fetchMock.mockResolvedValue(reponse(200));
    render(<FormulaireConnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin"));
  });

  it("ignore un ?suite= absolu (pas de redirection ouverte)", async () => {
    parametres.set("suite", "https://evil.example/vol");
    fetchMock.mockResolvedValue(reponse(200));
    render(<FormulaireConnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });

  it("401 : message unique qui ne distingue pas email inconnu et mauvais mot de passe", async () => {
    fetchMock.mockResolvedValue(reponse(401, { detail: "Identifiants incorrects." }));
    render(<FormulaireConnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Email ou mot de passe incorrect.");
    expect(push).not.toHaveBeenCalled();
  });

  it("429 : message de limitation distinct", async () => {
    fetchMock.mockResolvedValue(reponse(429));
    render(<FormulaireConnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Trop de tentatives. Réessaie dans quelques minutes.");
  });

  it("réseau coupé : message qui dit quoi vérifier", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<FormulaireConnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Impossible de contacter le serveur. Vérifie ta connexion.");
  });

  it("état de chargement : bouton désactivé et libellé « Connexion… »", async () => {
    const { promesse, liberer } = reponseSuspendue();
    fetchMock.mockReturnValue(promesse);
    render(<FormulaireConnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    const bouton = await screen.findByRole("button", { name: "Connexion…" });
    expect(bouton).toHaveProperty("disabled", true);

    liberer(reponse(200));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("efface l'erreur précédente au nouvel essai", async () => {
    fetchMock.mockResolvedValueOnce(reponse(401));
    render(<FormulaireConnexion />);
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await screen.findByRole("alert");

    const { promesse, liberer } = reponseSuspendue();
    fetchMock.mockReturnValueOnce(promesse);
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    liberer(reponse(200));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("navigation clavier : email → mot de passe → bouton → lien, et envoi par Entrée", async () => {
    fetchMock.mockResolvedValue(reponse(200));
    render(<FormulaireConnexion />);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Mot de passe"));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Se connecter" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Mot de passe oublié" }));

    screen.getByLabelText("Email").focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

describe("FormulaireInscription", () => {
  it("rend les trois champs, le téléphone étant facultatif", () => {
    render(<FormulaireInscription />);
    expect(screen.getByLabelText("Email")).toHaveProperty("required", true);
    expect(screen.getByLabelText("Téléphone")).toHaveProperty("required", false);
    expect(screen.getByLabelText("Mot de passe")).toHaveProperty("required", true);
    expect(screen.getByText("Au moins 10 caractères, pas un mot de passe courant.")).toBeTruthy();
  });

  it("chemin nominal : poste email + phone + password puis redirige", async () => {
    fetchMock.mockResolvedValue(reponse(201, {}));
    render(<FormulaireInscription />);

    await userEvent.type(screen.getByLabelText("Email"), "nouvelle@example.com");
    await userEvent.type(screen.getByLabelText("Téléphone"), "0550112233");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "un-mot-de-passe-long");
    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
    expect(appelFetch().corps).toEqual({
      email: "nouvelle@example.com",
      phone: "0550112233",
      password: "un-mot-de-passe-long",
    });

    // L'inscription ne connecte plus automatiquement (correctif d'énumération) :
    // le formulaire enchaîne un vrai POST /api/auth/login, sans le téléphone.
    const connexion = appelFetch(1);
    expect(connexion.url).toBe("/api/auth/login");
    expect(connexion.corps).toEqual({
      email: "nouvelle@example.com",
      password: "un-mot-de-passe-long",
    });
  });

  it("email déjà pris : la connexion enchaînée échoue, message neutre, pas de redirection", async () => {
    // C'est ici que se joue l'absence d'énumération : Django a répondu 201 dans les deux
    // cas ; seule la connexion distingue « compte créé » de « email déjà pris », et elle
    // le fait avec le vocabulaire d'un échec de connexion ordinaire.
    fetchMock
      .mockResolvedValueOnce(reponse(201, { detail: "Compte créé si l'email était disponible." }))
      .mockResolvedValueOnce(reponse(401, { detail: "Email ou mot de passe incorrect." }));
    render(<FormulaireInscription />);

    await userEvent.type(screen.getByLabelText("Email"), "deja-prise@example.com");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "un-mot-de-passe-long");
    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));

    // Pas une erreur : role="status", pas "alert" — le compte est bien créé.
    const info = await screen.findByRole("status");
    expect(info.textContent).toContain("Compte créé. Connecte-toi pour continuer.");
    expect(info.textContent).not.toMatch(/existe|déjà|pris/i);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("aucun cookie n'est attendu de /api/auth/register : deux appels, jamais un seul", async () => {
    fetchMock.mockResolvedValue(reponse(201, {}));
    render(<FormulaireInscription />);

    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(appelFetch(0).url).toBe("/api/auth/register");
    expect(appelFetch(1).url).toBe("/api/auth/login");
  });

  it("400 sur le mot de passe : le message de Django est rattaché au champ", async () => {
    fetchMock.mockResolvedValue(
      reponse(400, { password: ["Ce mot de passe est trop court.", "Il est trop courant."] }),
    );
    render(<FormulaireInscription />);

    await userEvent.type(screen.getByLabelText("Mot de passe"), "1234");
    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));

    const champ = await screen.findByLabelText("Mot de passe");
    await waitFor(() => expect(champ.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Ce mot de passe est trop court. Il est trop courant.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("400 sans détail exploitable : message générique, pas d'énumération", async () => {
    fetchMock.mockResolvedValue(reponse(400, { email: ["déjà pris"] }));
    render(<FormulaireInscription />);

    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Le compte n'a pas pu être créé. Réessaie.");
  });

  it("corps non JSON : ne casse pas, message générique", async () => {
    fetchMock.mockResolvedValue(new Response("<html>500</html>", { status: 500 }));
    render(<FormulaireInscription />);

    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Le compte n'a pas pu être créé. Réessaie.");
  });

  it("429 : message de limitation", async () => {
    fetchMock.mockResolvedValue(reponse(429));
    render(<FormulaireInscription />);

    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Trop de tentatives. Réessaie dans quelques minutes.");
  });

  it("réseau coupé : message réseau", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<FormulaireInscription />);

    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Impossible de contacter le serveur. Vérifie ta connexion.");
  });

  it("état de chargement : « Création du compte… » et bouton désactivé", async () => {
    const { promesse, liberer } = reponseSuspendue();
    fetchMock.mockReturnValue(promesse);
    render(<FormulaireInscription />);

    await userEvent.click(screen.getByRole("button", { name: "Créer mon compte" }));
    const bouton = await screen.findByRole("button", { name: "Création du compte…" });
    expect(bouton).toHaveProperty("disabled", true);

    liberer(reponse(201));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("navigation clavier : email → téléphone → mot de passe → bouton", async () => {
    render(<FormulaireInscription />);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Téléphone"));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Mot de passe"));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Créer mon compte" }));
  });
});

describe("FormulaireMotDePasseOublie", () => {
  it("chemin nominal : poste l'email puis affiche la confirmation neutre", async () => {
    fetchMock.mockResolvedValue(reponse(202));
    render(<FormulaireMotDePasseOublie />);

    await userEvent.type(screen.getByLabelText("Email"), "connue@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer le lien" }));

    expect(await screen.findByText(/Si un compte existe pour cet email/)).toBeTruthy();
    expect(appelFetch().corps).toEqual({ email: "connue@example.com" });
  });

  it("email inconnu (404 côté API) : exactement la même confirmation", async () => {
    fetchMock.mockResolvedValue(reponse(404));
    render(<FormulaireMotDePasseOublie />);

    await userEvent.click(screen.getByRole("button", { name: "Envoyer le lien" }));
    expect(await screen.findByText(/Si un compte existe pour cet email/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /* NB : `envoyer()` n'a pas de `catch`, seulement un `finally`. Un rejet de `fetch`
     (réseau coupé) remonte donc en promesse non gérée. L'affichage reste correct ;
     c'est consigné comme MINEUR dans le rapport, pas testé ici — le tester ferait
     échouer la suite sur une « unhandled rejection », ce qui est précisément le point.
     On couvre à la place l'échec serveur, qui ne rejette pas. */
  it("erreur 500 côté API : même confirmation, aucune fuite d'information", async () => {
    fetchMock.mockResolvedValue(reponse(500, { detail: "boom" }));
    render(<FormulaireMotDePasseOublie />);

    await userEvent.click(screen.getByRole("button", { name: "Envoyer le lien" }));
    expect(await screen.findByText(/Si un compte existe pour cet email/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("état de chargement : « Envoi… » et bouton désactivé", async () => {
    const { promesse, liberer } = reponseSuspendue();
    fetchMock.mockReturnValue(promesse);
    render(<FormulaireMotDePasseOublie />);

    await userEvent.click(screen.getByRole("button", { name: "Envoyer le lien" }));
    const bouton = await screen.findByRole("button", { name: "Envoi…" });
    expect(bouton).toHaveProperty("disabled", true);

    liberer(reponse(202));
    await screen.findByText(/Si un compte existe pour cet email/);
  });

  it("navigation clavier : email → bouton, envoi par Entrée", async () => {
    fetchMock.mockResolvedValue(reponse(202));
    render(<FormulaireMotDePasseOublie />);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe("FormulaireNouveauMotDePasse", () => {
  it("sans token dans l'URL : refuse d'afficher le formulaire", () => {
    render(<FormulaireNouveauMotDePasse />);

    expect(screen.getByRole("alert").textContent).toContain("Ce lien est incomplet");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("chemin nominal : poste token + mot de passe puis renvoie vers la connexion", async () => {
    parametres.set("token", "jeton-usage-unique");
    fetchMock.mockResolvedValue(reponse(200));
    render(<FormulaireNouveauMotDePasse />);

    await userEvent.type(screen.getByLabelText("Nouveau mot de passe"), "nouveau-mdp-long");
    await userEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/connexion"));
    expect(appelFetch().corps).toEqual({
      token: "jeton-usage-unique",
      password: "nouveau-mdp-long",
    });
  });

  it("400 sur le mot de passe : message rattaché au champ", async () => {
    parametres.set("token", "jeton");
    fetchMock.mockResolvedValue(reponse(400, { password: ["Ce mot de passe est trop courant."] }));
    render(<FormulaireNouveauMotDePasse />);

    await userEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }));

    expect(await screen.findByText("Ce mot de passe est trop courant.")).toBeTruthy();
    expect(screen.getByLabelText("Nouveau mot de passe").getAttribute("aria-invalid")).toBe("true");
  });

  it("token périmé ou déjà consommé : message qui dit quoi faire", async () => {
    parametres.set("token", "jeton-perime");
    fetchMock.mockResolvedValue(reponse(400, { detail: "invalide" }));
    render(<FormulaireNouveauMotDePasse />);

    await userEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }));
    expect(
      await screen.findByText("Ce lien n'est plus valable. Demande-en un nouveau."),
    ).toBeTruthy();
  });

  it("429 : message de limitation, sans lire le corps", async () => {
    parametres.set("token", "jeton");
    fetchMock.mockResolvedValue(reponse(429));
    render(<FormulaireNouveauMotDePasse />);

    await userEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }));
    expect(
      await screen.findByText("Trop de tentatives. Réessaie dans quelques minutes."),
    ).toBeTruthy();
  });

  it("réseau coupé : message réseau", async () => {
    parametres.set("token", "jeton");
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<FormulaireNouveauMotDePasse />);

    await userEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }));
    expect(
      await screen.findByText("Impossible de contacter le serveur. Vérifie ta connexion."),
    ).toBeTruthy();
  });

  it("état de chargement : « Enregistrement… » et bouton désactivé", async () => {
    parametres.set("token", "jeton");
    const { promesse, liberer } = reponseSuspendue();
    fetchMock.mockReturnValue(promesse);
    render(<FormulaireNouveauMotDePasse />);

    await userEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }));
    const bouton = await screen.findByRole("button", { name: "Enregistrement…" });
    expect(bouton).toHaveProperty("disabled", true);

    liberer(reponse(200));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("navigation clavier : champ → bouton", async () => {
    parametres.set("token", "jeton");
    render(<FormulaireNouveauMotDePasse />);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Nouveau mot de passe"));
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Changer le mot de passe" }),
    );
  });
});

describe("BoutonDeconnexion", () => {
  it("chemin nominal : appelle /api/auth/logout puis renvoie vers /connexion", async () => {
    fetchMock.mockResolvedValue(reponse(204));
    render(<BoutonDeconnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/connexion"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(refresh).toHaveBeenCalled();
  });

  /* Même remarque que pour le formulaire « mot de passe oublié » : pas de `catch`,
     donc un rejet réseau part en promesse non gérée (MINEUR, consigné au rapport). */
  it("API en échec (500) : renvoie quand même vers /connexion", async () => {
    fetchMock.mockResolvedValue(reponse(500, { detail: "boom" }));
    render(<BoutonDeconnexion />);

    fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/connexion"));
  });

  it("état de chargement : « Déconnexion… » et bouton désactivé", async () => {
    const { promesse, liberer } = reponseSuspendue();
    fetchMock.mockReturnValue(promesse);
    render(<BoutonDeconnexion />);

    await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
    const bouton = await screen.findByRole("button", { name: "Déconnexion…" });
    expect(bouton).toHaveProperty("disabled", true);

    liberer(reponse(204));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("atteignable au clavier et déclenché par Entrée", async () => {
    fetchMock.mockResolvedValue(reponse(204));
    render(<BoutonDeconnexion />);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Se déconnecter" }));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

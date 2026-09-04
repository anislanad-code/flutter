// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

const hlsCtrl = vi.hoisted(() => ({ supported: true }));

vi.mock("hls.js", () => {
  class Hls {
    static isSupported(): boolean {
      return hlsCtrl.supported;
    }
    static Events = { MANIFEST_PARSED: "hlsManifestParsed", ERROR: "hlsError" };
    on(evenement: string, callback: () => void): void {
      if (evenement === "hlsManifestParsed") queueMicrotask(callback);
    }
    loadSource(): void {}
    attachMedia(): void {}
    destroy(): void {}
  }
  return { default: Hls };
});

vi.mock("@/lib/filigrane", async (importOriginal) => {
  const actuel = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actuel,
    filigraneEstVisible: (noeud: HTMLElement, conteneur: HTMLElement) => conteneur.contains(noeud),
  };
});

import { LecteurSecurise } from "@/components/course/LecteurSecurise";

const LECTURE = {
  disponible: true,
  playback_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  playback_url:
    "https://vz-test.b-cdn.net/bcdn_token=HS256-abc&token_path=%2Fx%2F&expires=1/x/playlist.m3u8",
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  watermark_label: "etudiante · 2233",
  resume_at_s: 0,
  duration_s: 480,
};

const BATTEMENT = {
  active: true,
  expires_at: LECTURE.expires_at,
  resume_at_s: 12,
};

function reponseJson(corps: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
  } as Response;
}

function brancherFetch(
  heartbeat: (url: string) => Response | Promise<Response> = () => reponseJson(BATTEMENT),
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/heartbeat")) return heartbeat(url);
      return reponseJson(LECTURE);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  hlsCtrl.supported = true;
  brancherFetch();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    },
  );
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue("");
});

describe("LecteurSecurise", () => {
  it("demande un jeton au BFF, jamais à Django, et pose le filigrane", async () => {
    render(createElement(LecteurSecurise, { lessonId: 7, titre: "Installer Flutter" }));

    await waitFor(() => {
      expect(document.querySelector("video")).not.toBeNull();
    });

    expect(fetch).toHaveBeenCalledWith("/api/lessons/7/playback", { method: "POST" });
    const urls = vi.mocked(fetch).mock.calls.map((appel) => String(appel[0]));
    expect(urls.every((url) => !url.includes(":8000"))).toBe(true);

    expect(document.querySelector("[data-filigrane]")).not.toBeNull();
    expect(document.querySelector("video")?.getAttribute("controlslist")).toBe("nodownload");
  });

  it("neutralise le menu contextuel", async () => {
    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    const video = document.querySelector("video")!;
    const evenement = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    video.dispatchEvent(evenement);
    expect(evenement.defaultPrevented).toBe(true);
  });

  it("redemande un jeton si le filigrane est retiré du DOM", async () => {
    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("[data-filigrane]")).not.toBeNull());

    document.querySelector("[data-filigrane]")?.remove();

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1);
    });
    const pause = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;
    expect(pause).toHaveBeenCalled();
  });

  it("affiche l'état d'attente quand aucune vidéo n'est déposée", async () => {
    vi.mocked(fetch).mockResolvedValue(
      reponseJson({ ...LECTURE, disponible: false, playback_url: null, playback_id: null }),
    );

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "Installer Flutter" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Vidéo de « Installer Flutter » à venir/)).toBeTruthy();
    });
    expect(document.querySelector("video")).toBeNull();
  });

  it("ne révèle pas qu'une leçon payante existe", async () => {
    vi.mocked(fetch).mockResolvedValue(reponseJson({ detail: "Non trouvé." }, 404));

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "Premier widget" }));

    await waitFor(() => {
      expect(screen.getByText("Cette leçon n'est pas disponible.")).toBeTruthy();
    });
    expect(document.querySelector("video")).toBeNull();
  });

  it("demande de se reconnecter si la session a expiré", async () => {
    vi.mocked(fetch).mockResolvedValue(
      reponseJson({ detail: "Session invalide ou expirée." }, 401),
    );

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));

    await waitFor(() => {
      expect(screen.getByText("Ta session a expiré. Reconnecte-toi pour reprendre.")).toBeTruthy();
    });
    expect(document.querySelector("video")).toBeNull();
  });

  it("affiche un écran générique si le fetch lève", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("réseau coupé"));

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));

    await waitFor(() => {
      expect(screen.getByText("La vidéo est indisponible pour le moment.")).toBeTruthy();
    });
    expect(document.querySelector("video")).toBeNull();
  });

  it("affiche un écran générique sur 503", async () => {
    vi.mocked(fetch).mockResolvedValue(reponseJson({ detail: "Vidéo indisponible." }, 503));

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));

    await waitFor(() => {
      expect(screen.getByText("La vidéo est indisponible pour le moment.")).toBeTruthy();
    });
  });

  it("refuse une réponse hors schéma", async () => {
    vi.mocked(fetch).mockResolvedValue(reponseJson({ disponible: true }));

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));

    await waitFor(() => {
      expect(screen.getByText("Réponse inattendue du serveur.")).toBeTruthy();
    });
  });

  it("affiche l'état de chargement tant que le jeton n'arrive pas", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined) as Promise<Response>);

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "Installer Flutter" }));

    expect(screen.getByLabelText(/Chargement de la vidéo « Installer Flutter »/)).toBeTruthy();
    expect(screen.getByText("Chargement de la vidéo…")).toBeTruthy();
  });

  it("passe sur un autre appareil si le heartbeat répond 404", async () => {
    brancherFetch(() => reponseJson({ detail: "Non trouvé." }, 404));
    vi.useFakeTimers({ toFake: ["setInterval"] });

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Cette leçon est ouverte sur un autre appareil/),
      ).toBeTruthy();
    });
    expect(document.querySelector("video")).toBeNull();
  });

  it("reprend ici après un heartbeat 404", async () => {
    brancherFetch(() => reponseJson({ detail: "Non trouvé." }, 404));
    vi.useFakeTimers({ toFake: ["setInterval"] });

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Reprendre ici" })).toBeTruthy());

    vi.useRealTimers();
    brancherFetch();
    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole("button", { name: "Reprendre ici" }));

    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  });

  it("passe sur un autre appareil si le battement n'est plus actif", async () => {
    brancherFetch(() => reponseJson({ ...BATTEMENT, active: false }));
    vi.useFakeTimers({ toFake: ["setInterval"] });

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reprendre ici" })).toBeTruthy();
    });
  });

  it("signale un navigateur incapable de lire le HLS", async () => {
    hlsCtrl.supported = false;
    HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue("");

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));

    await waitFor(() => {
      expect(screen.getByText("Ton navigateur ne sait pas lire cette vidéo.")).toBeTruthy();
    });
  });

  it("utilise la lecture native HLS si hls.js n'est pas supporté", async () => {
    hlsCtrl.supported = false;
    HTMLMediaElement.prototype.canPlayType = vi.fn().mockReturnValue("maybe");

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));

    await waitFor(() => {
      const video = document.querySelector("video");
      expect(video?.getAttribute("src") ?? "").toContain("b-cdn.net");
    });

    await act(async () => {
      document.querySelector("video")!.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("coupe la lecture si le filigrane sort de l'intersection", async () => {
    let observer: ((entrees: Array<{ intersectionRatio: number }>) => void) | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entrees: Array<{ intersectionRatio: number }>) => void) {
          observer = callback;
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("[data-filigrane]")).not.toBeNull());
    const appelsAvant = vi.mocked(fetch).mock.calls.length;

    await act(async () => {
      observer?.([{ intersectionRatio: 0.1 }]);
    });

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(appelsAvant);
    });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("enregistre la position au timeupdate", async () => {
    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());

    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "currentTime", { value: 33, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event("timeupdate"));
    });
    expect(video.currentTime).toBe(33);
  });

  it("fait tourner l'ancrage du filigrane", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("[data-filigrane]")).not.toBeNull());
    expect(document.querySelector("[data-filigrane]")?.className).toContain("top-3 left-3");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(document.querySelector("[data-filigrane]")?.className).toContain("top-3 right-3");
  });

  it("redemande un jeton avant expiration", async () => {
    const vrais = window.setTimeout.bind(window);
    const captures: Array<() => void> = [];
    vi.spyOn(window, "setTimeout").mockImplementation((handler, delai) => {
      if (typeof delai === "number" && delai >= 5_000) {
        captures.push(handler as () => void);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }
      return vrais(handler, delai) as unknown as ReturnType<typeof setTimeout>;
    });

    render(createElement(LecteurSecurise, { lessonId: 7, titre: "T" }));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    const avant = vi.mocked(fetch).mock.calls.length;

    await act(async () => {
      captures[0]?.();
    });
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(avant);
    });
  });
});

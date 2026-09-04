"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { LecteurVideo } from "@/components/marketing/LecteurVideo";
import {
  ANCRAGES,
  CLASSES_ANCRAGE,
  INTERVALLE_ANCRAGE_MS,
  OPACITE_FILIGRANE,
  filigraneEstVisible,
  libelleFiligraneHorodate,
  type Ancrage,
} from "@/lib/filigrane";
import { battementSchema, lectureSchema, type Lecture } from "@/lib/playback-schemas";

const INTERVALLE_HEARTBEAT_MS = 15_000;
const MARGE_RAFRAICHISSEMENT_MS = 30_000;
const INTERVALLE_STYLE_MS = 1_000;

type Props = {
  lessonId: number;
  titre: string;
};

type Etat =
  | { phase: "chargement" }
  | { phase: "attente" }
  | { phase: "erreur"; message: string }
  | { phase: "autre-appareil" }
  | { phase: "lecture"; lecture: Lecture };

export function LecteurSecurise({ lessonId, titre }: Props) {
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });
  const [ancrage, setAncrage] = useState<Ancrage>("tl");
  const [horodatage, setHorodatage] = useState(() => libelleFiligraneHorodate("", new Date()));

  const videoRef = useRef<HTMLVideoElement>(null);
  const cadreRef = useRef<HTMLDivElement>(null);
  const filigraneRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const playbackIdRef = useRef<string | null>(null);
  const positionRef = useRef(0);
  const demandeRef = useRef<(reprendre: number) => Promise<void>>(async () => undefined);

  const detruireHls = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const attacherSource = useCallback(
    async (url: string, reprendre: number) => {
      const video = videoRef.current;
      if (!video) return;
      detruireHls();

      const { default: Hls } = await import("hls.js");
      if (Hls.isSupported()) {
        // Pas de worker : `default-src 'self'` bloquerait un blob: worker, et
        // un thread dédié n'apporte rien sur une leçon de quelques minutes.
        const hls = new Hls({ enableWorker: false, maxBufferLength: 30 });
        hls.loadSource(url);
        hls.attachMedia(video);
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.currentTime = reprendre;
          void video.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_evenement, donnees) => {
          if (typeof donnees !== "object" || donnees === null || !("fatal" in donnees)) return;
          if (!donnees.fatal) return;
          detruireHls();
          void demandeRef.current(positionRef.current);
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener(
          "loadedmetadata",
          () => {
            video.currentTime = reprendre;
            void video.play().catch(() => undefined);
          },
          { once: true },
        );
      } else {
        setEtat({ phase: "erreur", message: "Ton navigateur ne sait pas lire cette vidéo." });
      }
    },
    [detruireHls],
  );

  const demanderJeton = useCallback(
    async (reprendre: number) => {
      try {
        const reponse = await fetch(`/api/lessons/${lessonId}/playback`, { method: "POST" });
        if (reponse.status === 401) {
          setEtat({
            phase: "erreur",
            message: "Ta session a expiré. Reconnecte-toi pour reprendre.",
          });
          return;
        }
        if (reponse.status === 404) {
          setEtat({ phase: "erreur", message: "Cette leçon n'est pas disponible." });
          return;
        }
        if (!reponse.ok) {
          setEtat({ phase: "erreur", message: "La vidéo est indisponible pour le moment." });
          return;
        }
        const parsed = lectureSchema.safeParse(await reponse.json());
        if (!parsed.success) {
          setEtat({ phase: "erreur", message: "Réponse inattendue du serveur." });
          return;
        }
        if (!parsed.data.disponible || !parsed.data.playback_url || !parsed.data.playback_id) {
          setEtat({ phase: "attente" });
          return;
        }
        playbackIdRef.current = parsed.data.playback_id;
        const debut = reprendre > 0 ? reprendre : parsed.data.resume_at_s;
        positionRef.current = debut;
        setEtat({ phase: "lecture", lecture: parsed.data });
      } catch {
        setEtat({ phase: "erreur", message: "La vidéo est indisponible pour le moment." });
      }
    },
    [lessonId],
  );

  demandeRef.current = demanderJeton;

  const playbackId = etat.phase === "lecture" ? etat.lecture.playback_id : null;
  const playbackUrl = etat.phase === "lecture" ? etat.lecture.playback_url : null;

  useEffect(() => {
    void demanderJeton(0);
    return () => detruireHls();
  }, [demanderJeton, detruireHls]);

  useEffect(() => {
    if (!playbackId || !playbackUrl) return;
    void attacherSource(playbackUrl, positionRef.current);
  }, [playbackId, playbackUrl, attacherSource]);

  const couperPourAltération = useCallback(() => {
    videoRef.current?.pause();
    detruireHls();
    playbackIdRef.current = null;
    void demandeRef.current(positionRef.current);
  }, [detruireHls]);

  useLayoutEffect(() => {
    if (etat.phase !== "lecture") return;
    const video = videoRef.current;
    const cadre = cadreRef.current;
    const filigrane = filigraneRef.current;
    if (!video || !cadre || !filigrane) return;

    const observerMutation = new MutationObserver(() => {
      const attendu = etat.phase === "lecture" ? etat.lecture.watermark_label : undefined;
      if (!filigraneEstVisible(filigrane, cadre, attendu)) couperPourAltération();
    });
    observerMutation.observe(cadre, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });

    let observerIntersection: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observerIntersection = new IntersectionObserver(
        (entrees) => {
          if (entrees.some((entree) => entree.intersectionRatio < 0.4)) couperPourAltération();
        },
        { root: cadre, threshold: [0, 0.4, 1] },
      );
      observerIntersection.observe(filigrane);
    }

    const tickStyle = window.setInterval(() => {
      const attendu = etat.phase === "lecture" ? etat.lecture.watermark_label : undefined;
      if (!filigraneEstVisible(filigrane, cadre, attendu)) couperPourAltération();
    }, INTERVALLE_STYLE_MS);

    return () => {
      observerMutation.disconnect();
      observerIntersection?.disconnect();
      window.clearInterval(tickStyle);
    };
  }, [couperPourAltération, etat]);

  useEffect(() => {
    if (etat.phase !== "lecture") return;
    const tickAncrage = window.setInterval(() => {
      setAncrage((actuel) => {
        const index = ANCRAGES.indexOf(actuel);
        return ANCRAGES[(index + 1) % ANCRAGES.length] ?? "tl";
      });
      setHorodatage(libelleFiligraneHorodate(etat.lecture.watermark_label, new Date()));
    }, INTERVALLE_ANCRAGE_MS);
    setHorodatage(libelleFiligraneHorodate(etat.lecture.watermark_label, new Date()));
    return () => window.clearInterval(tickAncrage);
  }, [etat]);

  useEffect(() => {
    if (etat.phase !== "lecture" || !etat.lecture.expires_at) return;
    const expireA = Date.parse(etat.lecture.expires_at);
    const delay = Math.max(expireA - Date.now() - MARGE_RAFRAICHISSEMENT_MS, 5_000);
    const timer = window.setTimeout(() => {
      void demandeRef.current(positionRef.current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [etat]);

  useEffect(() => {
    if (etat.phase !== "lecture") return;
    const tick = window.setInterval(() => {
      const id = playbackIdRef.current;
      const video = videoRef.current;
      if (!id) return;
      if (video && !video.paused) positionRef.current = Math.floor(video.currentTime);
      void fetch(`/api/playback/${id}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watched_s: positionRef.current }),
      }).then(async (reponse) => {
        if (id !== playbackIdRef.current) return;
        if (reponse.status === 404) {
          video?.pause();
          setEtat({ phase: "autre-appareil" });
          return;
        }
        if (!reponse.ok) return;
        const parsed = battementSchema.safeParse(await reponse.json());
        if (parsed.success && !parsed.data.active) {
          video?.pause();
          setEtat({ phase: "autre-appareil" });
        }
      });
    }, INTERVALLE_HEARTBEAT_MS);
    return () => window.clearInterval(tick);
  }, [etat.phase, playbackId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      positionRef.current = Math.floor(video.currentTime);
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [etat.phase]);

  if (etat.phase === "attente") {
    return <LecteurVideo src={null} titre={titre} />;
  }

  if (etat.phase === "erreur") {
    return (
      <div
        role="status"
        className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-ink px-6 text-center text-paper"
      >
        <p className="max-w-mesure text-[length:var(--texte-base)]">{etat.message}</p>
      </div>
    );
  }

  if (etat.phase === "autre-appareil") {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-lg bg-ink px-6 text-center text-paper">
        <p className="max-w-mesure text-[length:var(--texte-base)]">
          Cette leçon est ouverte sur un autre appareil. Relance ici pour reprendre.
        </p>
        <button
          type="button"
          className="min-h-11 cursor-pointer rounded bg-zellige px-4 py-2 text-[length:var(--texte-base)] text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-safran"
          onClick={() => {
            setEtat({ phase: "chargement" });
            void demanderJeton(positionRef.current);
          }}
        >
          Reprendre ici
        </button>
      </div>
    );
  }

  if (etat.phase === "chargement") {
    return (
      <div
        role="status"
        aria-label={`Chargement de la vidéo « ${titre} »`}
        className="flex aspect-video w-full items-center justify-center rounded-lg bg-ink text-paper"
      >
        <p className="text-[length:var(--texte-base)]">Chargement de la vidéo…</p>
      </div>
    );
  }

  return (
    <div ref={cadreRef} className="relative aspect-video w-full overflow-hidden rounded-lg bg-ink">
      <video
        ref={videoRef}
        controls
        controlsList="nodownload"
        disablePictureInPicture
        playsInline
        onContextMenu={(evenement) => evenement.preventDefault()}
        className="h-full w-full"
        aria-label={titre}
      >
        Ton navigateur ne sait pas lire cette vidéo.
      </video>
      <div
        ref={filigraneRef}
        data-filigrane="1"
        aria-hidden="true"
        className={`pointer-events-none absolute z-10 max-w-[90%] select-none text-[length:var(--texte-sm)] text-paper ${CLASSES_ANCRAGE[ancrage]}`}
        style={{ opacity: OPACITE_FILIGRANE }}
      >
        {horodatage}
      </div>
    </div>
  );
}

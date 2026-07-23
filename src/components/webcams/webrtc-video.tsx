"use client";

import { useEffect, useRef, useState } from "react";

interface WebRTCVideoProps {
  go2rtcUrl: string;
  src: string;
  audio?: boolean;
  microphone?: boolean;
  className?: string;
  /** Alternativer Bild-URL als Fallback, falls WebRTC offline geht. */
  snapshotUrl?: string;
  /** "contain" für Panorama-Cams (Duo 3, ~32:9), sonst croppt object-cover. */
  fit?: "cover" | "contain";
  /** Setzen, um einen erzwungenen Reconnect auszulösen. */
  reloadKey?: number;
  onConnected?: () => void;
  onError?: (err: Error) => void;
}

/**
 * Verbindet sich via WHEP-ähnlichem POST gegen go2rtc /api/webrtc.
 * go2rtc erwartet das SDP als request body und liefert das SDP-Answer im response body.
 */
export function WebRTCVideo({
  go2rtcUrl,
  src,
  audio = false,
  microphone = false,
  className,
  snapshotUrl,
  fit = "cover",
  reloadKey = 0,
  onConnected,
  onError,
}: WebRTCVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "idle">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Stream nur verbinden, solange die Kachel tatsächlich im Viewport ist.
  // Spart Decode/CPU/Bandbreite, sobald eine Kachel weggescrollt oder
  // ausgeblendet wird. Im Standard-Single-Screen-Grid bleibt alles `true`.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e.isIntersecting) {
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          setVisible(true);
        } else {
          // Grace-Periode gegen Flackern bei kurzem Scrollen/Layout-Shift.
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => setVisible(false), 1500);
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      obs.disconnect();
    };
  }, []);

  // Stabile Callback-Refs, sodass die Effekt-Schleife nicht alle 5s neu connectet,
  // wenn der Parent eine neue Inline-Funktion übergibt.
  const onConnectedRef = useRef(onConnected);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onConnectedRef.current = onConnected;
    onErrorRef.current = onError;
  }, [onConnected, onError]);

  useEffect(() => {
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let micStream: MediaStream | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogTimer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    /** Letzter beobachteter `video.currentTime` + Zeitstempel für Stall-Detection. */
    let lastFrameTime = 0;
    let lastFrameAtMs = 0;

    const cleanupPeer = () => {
      if (pc) {
        try {
          pc.getSenders().forEach((s) => s.track?.stop());
          pc.close();
        } catch {
          /* ignore */
        }
        pc = null;
      }
      // MediaStream-Referenz am <video> lösen — sonst hält Safari den
      // Decoder-/Stream-Speicher über Tage fest (Kiosk-Memory-Leak).
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (micStream) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
      }
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
    };

    /**
     * Erkennt einen „eingefrorenen" Stream: WebRTC ist offiziell `connected`,
     * aber das `<video>`-Element bekommt seit > 8 s keinen neuen Frame mehr
     * (`currentTime` bleibt stehen). Passiert bei Reolink + go2rtc nach NAT-
     * Refresh, Kamera-Reboot oder simpel nach Tagen Laufzeit. Wir machen dann
     * einen sauberen Reconnect.
     */
    const startWatchdog = () => {
      if (watchdogTimer) clearInterval(watchdogTimer);
      lastFrameTime = 0;
      lastFrameAtMs = Date.now();
      watchdogTimer = setInterval(() => {
        if (cancelled) return;
        const v = videoRef.current;
        if (!v || !pc || pc.connectionState !== "connected") return;
        const now = Date.now();
        const t = v.currentTime;
        if (t !== lastFrameTime) {
          lastFrameTime = t;
          lastFrameAtMs = now;
          return;
        }
        // Wenn das Element noch nichts decodiert hat (readyState < HAVE_CURRENT_DATA)
        // ist das noch keine Stall — wir warten bis erste Frames durchgekommen sind.
        if (v.readyState < 2) {
          lastFrameAtMs = now;
          return;
        }
        if (now - lastFrameAtMs > 8000) {
          console.warn(`[webrtc:${src}] stalled (no frame ${now - lastFrameAtMs}ms) — reconnect`);
          setStatus("error");
          setErrMsg("frame-stall");
          cleanupPeer();
          scheduleRetry();
        }
      }, 2000);
    };

    const connect = async () => {
      try {
        setStatus("connecting");
        setErrMsg(null);

        // Reines LAN-Setup: kein Public-STUN. go2rtc liefert explizite
        // Host-Kandidaten, daher sammeln wir nur lokale (Host-)Kandidaten ein,
        // was den Verbindungsaufbau beschleunigt.
        pc = new RTCPeerConnection({ iceServers: [] });
        pcRef.current = pc;

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", {
          direction: microphone ? "sendrecv" : audio ? "recvonly" : "inactive",
        });

        if (microphone) {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
            });
            micStream.getTracks().forEach((t) => {
              pc!.addTrack(t, micStream!);
            });
          } catch (e) {
            console.warn("[webrtc] microphone access denied", e);
          }
        }

        pc.ontrack = (ev) => {
          if (videoRef.current && ev.streams[0]) {
            videoRef.current.srcObject = ev.streams[0];
          }
        };

        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === "connected") {
            attempts = 0;
            setStatus("live");
            startWatchdog();
            onConnectedRef.current?.();
          } else if (
            pc.connectionState === "failed" ||
            pc.connectionState === "disconnected" ||
            pc.connectionState === "closed"
          ) {
            setStatus("error");
            setErrMsg(`connection ${pc.connectionState}`);
            // Sofort aufräumen statt die tote PC-Instanz während des
            // Backoffs (bis 15 s) offen zu halten.
            cleanupPeer();
            scheduleRetry();
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const url = `${go2rtcUrl.replace(/\/$/, "")}/api/webrtc?src=${encodeURIComponent(src)}`;
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/sdp" },
            body: offer.sdp ?? "",
          });
        } catch {
          // Netzwerk-Error (go2rtc nicht erreichbar). Stiller behandeln.
          throw new Error("go2rtc nicht erreichbar");
        }
        if (!res.ok) {
          throw new Error(`go2rtc ${res.status} ${res.statusText}`);
        }
        const answerSdp = await res.text();
        if (cancelled || !pc) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch (err) {
        if (cancelled) return;
        const e = err as Error;
        // console.warn statt console.error, sonst zeigt Next.js Dev-Overlay den Stream-Fehler.
        if (attempts === 0) {
          console.warn(`[webrtc:${src}] connect failed:`, e.message);
        }
        setStatus("error");
        setErrMsg(e.message);
        onErrorRef.current?.(e);
        cleanupPeer();
        scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      attempts += 1;
      // exponential backoff: 2s, 4s, 8s, max 15s
      const delay = Math.min(15_000, 2_000 * 2 ** Math.min(3, attempts - 1));
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (cancelled) return;
        cleanupPeer();
        connect();
      }, delay);
    };

    // Solange die Kachel nicht sichtbar ist: gar nicht erst verbinden.
    // Beim Wechsel auf unsichtbar lief der Cleanup unten bereits (Dep-Change),
    // d.h. eine bestehende Verbindung wurde sauber abgebaut.
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    if (visible) {
      // Globale Refresh-Trigger (Tab-Wake, periodischer Reset) reconnecten
      // sonst alle Kacheln im exakt gleichen Moment → kurzer Total-Blackout
      // und Lastspitze auf go2rtc. Kleiner zufälliger Versatz staggert das.
      const jitterMs = reloadKey > 0 ? Math.random() * 1500 : 0;
      if (jitterMs > 0) {
        initialTimer = setTimeout(() => {
          if (!cancelled) connect();
        }, jitterMs);
      } else {
        connect();
      }
    } else {
      setStatus("idle");
    }

    return () => {
      cancelled = true;
      if (initialTimer) clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
      cleanupPeer();
      pcRef.current = null;
    };
  }, [go2rtcUrl, src, audio, microphone, reloadKey, visible]);

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className ?? ""}`}>
      <video
        ref={videoRef}
        autoPlay
        muted={!audio}
        playsInline
        className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
      />
      {visible && status !== "live" && snapshotUrl && (
        <SnapshotFallback url={snapshotUrl} fit={fit} />
      )}
      {/* Klarer "Nicht live"-Marker, sobald der Stream nicht laeuft aber ein
          Standbild gezeigt wird - sonst wirkt die Kachel faelschlich live. */}
      {visible && status === "error" && snapshotUrl && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-200 ring-1 ring-white/15">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Nicht live
        </span>
      )}
      {visible && status !== "live" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center text-xs text-white/70">
          <span className="rounded-full bg-black/70 px-3 py-1 ring-1 ring-white/10">
            {status === "connecting" && (snapshotUrl ? "Verbinde… – Standbild" : "Verbinde…")}
            {status === "error" && (snapshotUrl ? `Nicht live – Standbild` : `Stream offline${errMsg ? ` – ${errMsg}` : ""}`)}
            {status === "idle" && "Bereit"}
          </span>
        </div>
      )}
    </div>
  );
}

function SnapshotFallback({ url, fit = "cover" }: { url: string; fit?: "cover" | "contain" }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let lastObjectUrl: string | null = null;
    const tick = async () => {
      try {
        const sep = url.includes("?") ? "&" : "?";
        const r = await fetch(`${url}${sep}_t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw new Error("snapshot");
        const blob = await r.blob();
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        setSrc(u);
        if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = u;
      } catch {
        /* ignore – go2rtc/cam down */
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    };
  }, [url]);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`absolute inset-0 h-full w-full opacity-90 ${fit === "contain" ? "object-contain" : "object-cover"}`}
    />
  );
}

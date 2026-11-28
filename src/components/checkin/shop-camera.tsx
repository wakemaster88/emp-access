"use client";

/**
 * Kamera des Shop-Scans (28.11.2026, Aaron: „Erkennung nicht gut, und Kamera
 * immer an“).
 *
 * Gelesen wird jedes Kamerabild in voller Auflösung über die BarcodeDetector-
 * Schnittstelle des Browsers. Wo sie fehlt (Safari, Firefox, Chrome unter
 * Windows und Linux), springt der ZXing-Nachbau aus `barcode-detector` ein;
 * seine WebAssembly-Datei kommt vom eigenen Server (`scripts/scanner-wasm.mjs`
 * kopiert sie nach public/scanner), nie von einem CDN. Vorher las html5-qrcode
 * nur einen auf Bildschirmgröße verkleinerten Ausschnitt: Der kleine QR-Code
 * des Preisetiketts (51 × 25 mm) hatte darin kaum ein Pixel je Modul.
 *
 * Die Kamera läuft nur, solange jemand sie braucht: Sie startet erst auf Tipp,
 * geht nach `CAMERA_IDLE_OFF_MS` ohne erkannten Code aus, ebenso wenn die Seite
 * in den Hintergrund geht oder der Shop schließt. Ein Etikett, das vor der
 * Kamera liegen bleibt, zählt nur einmal (`cameraCodeGate`).
 */
import { useEffect, useRef, useState } from "react";
import type { BarcodeFormat } from "barcode-detector/ponyfill";
import { Loader2, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAMERA_IDLE_OFF_MS, cameraCodeGate, mirrorCameraPreview } from "@/lib/shop-scan";

interface DetectedCode {
  rawValue: string;
}

interface Detector {
  detect(source: CanvasImageSource): Promise<DetectedCode[]>;
}

interface DetectorClass {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

/** Etikett-QR und die Strichcodes auf Verpackungen; weniger Formate lesen schneller. */
const FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

/** Pause zwischen zwei Bildern: genug für flüssiges Lesen, ohne das Gerät heiß zu machen. */
const FRAME_PAUSE_MS = 120;

let detectorPromise: Promise<Detector> | null = null;

/** Eigener Detektor des Browsers, wenn er QR-Codes kann, sonst der ZXing-Nachbau. */
function loadDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    if (native) {
      try {
        const supported = await native.getSupportedFormats();
        const formats = FORMATS.filter((f) => supported.includes(f));
        if (formats.includes("qr_code")) return new native({ formats });
      } catch {
        /* dann der Nachbau */
      }
    }
    const ponyfill = await import("barcode-detector/ponyfill");
    ponyfill.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/scanner/${path}` : `${prefix}${path}`),
      },
    });
    return new ponyfill.BarcodeDetector({ formats: FORMATS as BarcodeFormat[] });
  })().catch((err) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}

function cameraErrorText(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "Kein Zugriff auf die Kamera. Bitte die Kamera für diese Seite im Browser freigeben.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Keine Kamera gefunden.";
  if (name === "NotReadableError") return "Die Kamera wird gerade von einem anderen Programm benutzt.";
  return "Die Kamera ließ sich nicht starten.";
}

export function ShopCamera({
  onCode,
  onStop,
}: {
  /** Erkannter Code, unverändert (der Server liest die Artikelnummer heraus). */
  onCode: (raw: string) => void;
  /** Kamera ist von selbst ausgegangen (Pause, Hintergrund, Fehler): Grund für die Anzeige. */
  onStop: (reason: { kind: "idle" | "hidden" | "error"; text: string }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const onStopRef = useRef(onStop);
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);
  const [ready, setReady] = useState(false);
  const [mirror, setMirror] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frameTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let last: { code: string; at: number } | null = null;

    const release = () => {
      stopped = true;
      if (frameTimer) clearTimeout(frameTimer);
      if (idleTimer) clearTimeout(idleTimer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const stopWith = (reason: { kind: "idle" | "hidden" | "error"; text: string }) => {
      if (stopped) return;
      release();
      onStopRef.current(reason);
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => stopWith({ kind: "idle", text: `Kamera nach ${Math.round(CAMERA_IDLE_OFF_MS / 60_000)} Minute ohne Scan ausgeschaltet.` }),
        CAMERA_IDLE_OFF_MS,
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopWith({ kind: "hidden", text: "Kamera ausgeschaltet, weil die Seite im Hintergrund war." });
    };
    document.addEventListener("visibilitychange", onVisibility);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Die Kamera braucht eine sichere Verbindung (https).");
        // Detektor und Kamera gleichzeitig holen; hohe Auflösung, damit der kleine Etikett-QR genug Pixel hat.
        const [detector, media] = await Promise.all([
          loadDetector(),
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          }),
        ]);
        if (stopped) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        const track = media.getVideoTracks()[0];
        // Dauerfokus, wo die Kamera ihn kann (Android); sonst bleibt es beim Standard.
        track?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        setMirror(mirrorCameraPreview(track?.getSettings().facingMode, window.matchMedia?.("(pointer: fine)").matches ?? false));
        const video = videoRef.current;
        if (!video) throw new Error("Die Kameraansicht fehlt.");
        video.srcObject = media;
        await video.play();
        if (stopped) return;
        setReady(true);
        armIdle();

        const frame = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const found = await detector.detect(video);
              const raw = found.find((f) => f.rawValue.trim().length > 0)?.rawValue.trim();
              if (raw && !stopped) {
                armIdle();
                const gate = cameraCodeGate(last, raw, Date.now());
                last = gate.last;
                if (gate.report) {
                  navigator.vibrate?.(40);
                  onCodeRef.current(raw);
                }
              }
            }
          } catch {
            /* ein einzelnes Bild darf scheitern, das nächste versucht es neu */
          }
          if (!stopped) frameTimer = setTimeout(() => void frame(), FRAME_PAUSE_MS);
        };
        void frame();
      } catch (err) {
        if (stopped) return;
        stopWith({ kind: "error", text: err instanceof Error && !(err instanceof DOMException) ? err.message : cameraErrorText(err) });
      }
    })();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, []);

  return (
    <div className="relative mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-tile bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Kamerabild"
        className={cn("absolute inset-0 size-full object-cover", mirror && "-scale-x-100")}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8 text-sm font-medium text-white">
        {ready ? <ScanLine className="size-4 shrink-0" /> : <Loader2 className="size-4 shrink-0 animate-spin" />}
        <span aria-live="polite">{ready ? "Etikett mit dem QR-Code nah vor die Kamera halten" : "Kamera startet …"}</span>
      </div>
    </div>
  );
}

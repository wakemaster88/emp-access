"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, DoorOpen, Lightbulb, Mic, MicOff, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { WebRTCVideo } from "@/components/tiles/webrtc-video";
import { cn } from "@/lib/utils";

interface DoorbirdOverlayProps {
  go2rtcUrl: string;
  ringSoundUrl?: string;
  autoHideSec: number;
  onClose: () => void;
}

const HOLD_DURATION_MS = 1000;

export function DoorbirdOverlay({
  go2rtcUrl,
  ringSoundUrl,
  autoHideSec,
  onClose,
}: DoorbirdOverlayProps) {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [talking, setTalking] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number>(Date.now());

  // Play ring sound on mount
  useEffect(() => {
    const url = ringSoundUrl || "";
    if (!url) return;
    try {
      const a = new Audio(url);
      a.volume = 0.7;
      a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }, [ringSoundUrl]);

  // Auto-hide
  useEffect(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    autoHideTimer.current = setTimeout(onClose, autoHideSec * 1000);
    return () => {
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    };
  }, [autoHideSec, onClose]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key.toLowerCase() === "o") {
        // Hold-to-confirm via key still requires actual hold; we ignore tap here.
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startHold = useCallback(() => {
    if (opening || opened) return;
    setHoldProgress(0);
    const started = Date.now();
    holdTimer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - started) / HOLD_DURATION_MS);
      setHoldProgress(p);
      if (p >= 1) {
        if (holdTimer.current) clearInterval(holdTimer.current);
        holdTimer.current = null;
        triggerOpen();
      }
    }, 30);
  }, [opening, opened]);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
    setHoldProgress(0);
  }, []);

  async function triggerOpen() {
    setOpening(true);
    try {
      const r = await fetch("/api/doorbird/open", { method: "POST" });
      const json = await r.json();
      if (r.ok && json.ok) {
        setOpened(true);
        toast("Tür geöffnet", "success");
      } else {
        toast(json.error ?? "Fehler", "error");
      }
    } catch (e) {
      toast(`Fehler: ${(e as Error).message}`, "error");
    } finally {
      setOpening(false);
    }
  }

  async function triggerLight() {
    try {
      const r = await fetch("/api/doorbird/light", { method: "POST" });
      const j = await r.json();
      if (j.ok) toast("Licht eingeschaltet", "success");
      else toast(j.error ?? "Fehler", "error");
    } catch (e) {
      toast(`Fehler: ${(e as Error).message}`, "error");
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md">
      <div className="relative flex h-[90%] w-[90%] flex-col gap-4 overflow-hidden rounded-3xl bg-tile p-4 ring-1 ring-border shadow-2xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="size-5 text-amber-400" />
            <div>
              <div className="text-xl font-medium tracking-tight">Klingel</div>
              <div className="text-xs text-foreground/50">
                {new Date(startedAt.current).toLocaleTimeString("de-DE")}
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Schließen">
            <X className="size-5" />
            Schließen (Esc)
          </Button>
        </header>

        <div className="grid flex-1 min-h-0 gap-4 lg:grid-cols-[1fr_320px]">
          <div className="relative min-h-0 overflow-hidden rounded-2xl bg-black">
            <WebRTCVideo
              go2rtcUrl={go2rtcUrl}
              src="doorbird"
              audio
              microphone={talking}
              key={talking ? "talk" : "listen"}
            />
          </div>

          <div className="flex flex-col gap-3">
            <Button
              variant={opened ? "secondary" : "destructive"}
              size="lg"
              className={cn(
                "relative h-24 w-full overflow-hidden text-lg",
                holdProgress > 0 && !opened && "ring-4 ring-amber-400/60",
              )}
              onPointerDown={startHold}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              disabled={opening}
            >
              <span
                className="pointer-events-none absolute inset-y-0 left-0 bg-amber-500/30 transition-[width]"
                style={{ width: `${holdProgress * 100}%` }}
              />
              <span className="relative flex items-center gap-3">
                {opening ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <DoorOpen className="size-6" />
                )}
                {opened
                  ? "Tür geöffnet"
                  : opening
                    ? "Öffne…"
                    : "Tür öffnen (1 s halten)"}
              </span>
            </Button>

            <Button
              variant={talking ? "warning" : "secondary"}
              size="lg"
              className="h-16 text-base"
              onPointerDown={() => setTalking(true)}
              onPointerUp={() => setTalking(false)}
              onPointerLeave={() => setTalking(false)}
              onPointerCancel={() => setTalking(false)}
            >
              {talking ? <Mic className="size-5" /> : <MicOff className="size-5" />}
              {talking ? "Sprich jetzt…" : "Sprechen (halten)"}
            </Button>

            <Button variant="secondary" size="lg" className="h-16 text-base" onClick={triggerLight}>
              <Lightbulb className="size-5" />
              Licht einschalten
            </Button>

            <div className="mt-auto rounded-xl bg-tile-accent/60 p-3 text-xs text-foreground/60 ring-1 ring-border">
              <p>
                Tür-Öffnen ist aus Sicherheitsgründen nur innerhalb des Ring-Fensters
                möglich. Halte den roten Knopf 1 s gedrückt, um Versehen zu vermeiden.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

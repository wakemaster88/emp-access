"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, DoorOpen, Lightbulb, Loader2, Mic, MicOff } from "lucide-react";
import { TileFrame } from "./tile-frame";
import { WebRTCVideo } from "./webrtc-video";
import { SnapshotImage } from "./snapshot-image";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { subscribeRing } from "@/components/use-doorbird-events";
import { cn } from "@/lib/utils";
import type { DoorbirdConfig, DoorbirdWidget } from "@/lib/types";

interface DoorbirdTileProps {
  widget: DoorbirdWidget;
  doorbird: DoorbirdConfig;
  go2rtcUrl: string;
  focused: boolean;
  onFocus?: () => void;
}

const HOLD_DURATION_MS = 1000;

export function DoorbirdTile({
  widget,
  doorbird,
  go2rtcUrl,
  focused,
  onFocus,
}: DoorbirdTileProps) {
  const ringing = useDoorbirdRing(doorbird.enabled, doorbird.ringWindowSec);

  if (!doorbird.enabled || !doorbird.ip) {
    return (
      <TileFrame
        title={widget.title}
        showTitleBar={widget.showTitleBar}
        onClick={onFocus}
      >
        <div className="flex h-full items-center justify-center text-sm text-white/60">
          Doorbird nicht konfiguriert
        </div>
      </TileFrame>
    );
  }

  const badge = (
    <div
      className={cn(
        "flex items-center gap-1 text-[10px] uppercase tracking-wider",
        ringing.active ? "text-red-300 animate-pulse" : "text-white/50",
      )}
    >
      <Bell className="size-3" />
      <span>{ringing.active ? "KLINGELT" : "Klingel"}</span>
    </div>
  );

  return (
    <TileFrame
      title={widget.title}
      showTitleBar={widget.showTitleBar}
      focused={focused}
      badge={badge}
      onClick={focused ? undefined : onFocus}
      className={cn(
        ringing.active && "pulse-ring ring-2 ring-red-500/80",
      )}
    >
      {focused ? (
        <DoorbirdFocus go2rtcUrl={go2rtcUrl} />
      ) : (
        <DoorbirdGrid
          snapshotIntervalMs={widget.snapshotIntervalMs}
          ringing={ringing}
        />
      )}
    </TileFrame>
  );
}

interface RingingState {
  active: boolean;
  remainingSec: number;
}

/**
 * Subscribt auf den Ring-SSE-Stream und liefert den aktiven Klingel-Status
 * (innerhalb des Ring-Fensters). Beim Mounten wird via /api/doorbird/test ein
 * letzter Ring-Zeitstempel mitgenommen; alle weiteren Klingelvorgänge kommen
 * via SSE.
 */
function useDoorbirdRing(enabled: boolean, ringWindowSec: number): RingingState {
  const [ringingAt, setRingingAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  // Geteiltes SSE-Abo — eine EventSource für alle Doorbird-Komponenten.
  useEffect(() => {
    if (!enabled) return;
    return subscribeRing(() => setRingingAt(Date.now()));
  }, [enabled]);

  // 1-Sekunden-Tick, damit `remainingSec` runterzählt
  useEffect(() => {
    if (!ringingAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [ringingAt]);

  if (!ringingAt) return { active: false, remainingSec: 0 };
  const elapsed = (Date.now() - ringingAt) / 1000;
  const remaining = Math.max(0, Math.floor(ringWindowSec - elapsed));
  return { active: remaining > 0, remainingSec: remaining };
}

/**
 * Snapshot + kompakter Tür-Öffnen-Button im Grid-Modus.
 * Hold-to-confirm bleibt erhalten (versehentliches Klicken vermeiden).
 * Server prüft das Ring-Fenster — im Klingel-Fall geht der Button auf,
 * sonst Toast-Fehler.
 */
function DoorbirdGrid({
  snapshotIntervalMs,
  ringing,
}: {
  snapshotIntervalMs: number;
  ringing: RingingState;
}) {
  const open = useOpenDoor();
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative flex-1 min-h-0">
        <SnapshotImage url="/api/doorbird/snapshot" intervalMs={snapshotIntervalMs} />
        {ringing.active && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-red-500/85 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-white shadow-lg">
            <Bell className="size-4 animate-pulse" />
            <span>Es klingelt</span>
            <span className="text-white/80">· {ringing.remainingSec}s</span>
          </div>
        )}
      </div>
      <div className="shrink-0 p-2">
        <OpenDoorButton {...open} compact ringing={ringing.active} />
      </div>
    </div>
  );
}

/**
 * Live-Stream + Steuer-Buttons im Focus-Modus.
 * Tür-Öffnen funktioniert nur innerhalb des Ring-Fensters (Server-seitig erzwungen).
 */
function DoorbirdFocus({ go2rtcUrl }: { go2rtcUrl: string }) {
  const { toast } = useToast();
  const open = useOpenDoor();
  const [talking, setTalking] = useState(false);

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
    <div className="absolute inset-0 flex flex-col gap-3 p-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
        <WebRTCVideo
          go2rtcUrl={go2rtcUrl}
          src="doorbird"
          audio
          microphone={talking}
          snapshotUrl="/api/doorbird/snapshot"
          key={talking ? "talk" : "listen"}
        />
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <OpenDoorButton {...open} />

        <Button
          variant={talking ? "warning" : "secondary"}
          size="lg"
          className="h-14 text-sm"
          onPointerDown={() => setTalking(true)}
          onPointerUp={() => setTalking(false)}
          onPointerLeave={() => setTalking(false)}
          onPointerCancel={() => setTalking(false)}
        >
          {talking ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {talking ? "Sprich…" : "Sprechen"}
        </Button>

        <Button
          variant="secondary"
          size="lg"
          className="h-14 text-sm"
          onClick={triggerLight}
        >
          <Lightbulb className="size-4" />
          Licht
        </Button>
      </div>
    </div>
  );
}

interface OpenDoorState {
  opening: boolean;
  opened: boolean;
  holdProgress: number;
  startHold: (e: React.PointerEvent) => void;
  cancelHold: () => void;
}

function useOpenDoor(): OpenDoorState {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const triggerOpen = useCallback(async () => {
    setOpening(true);
    try {
      const r = await fetch("/api/doorbird/open", { method: "POST" });
      const json = await r.json();
      if (r.ok && json.ok) {
        setOpened(true);
        toast("Tür geöffnet", "success");
        setTimeout(() => setOpened(false), 4000);
      } else {
        toast(json.error ?? "Fehler", "error");
      }
    } catch (e) {
      toast(`Fehler: ${(e as Error).message}`, "error");
    } finally {
      setOpening(false);
    }
  }, [toast]);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
    setHoldProgress(0);
  }, []);

  const startHold = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
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
    },
    [opening, opened, triggerOpen],
  );

  useEffect(() => () => cancelHold(), [cancelHold]);

  return { opening, opened, holdProgress, startHold, cancelHold };
}

function OpenDoorButton({
  opening,
  opened,
  holdProgress,
  startHold,
  cancelHold,
  compact = false,
  ringing = false,
}: OpenDoorState & { compact?: boolean; ringing?: boolean }) {
  return (
    <Button
      variant={opened ? "secondary" : "destructive"}
      size="lg"
      className={cn(
        "relative w-full overflow-hidden text-sm",
        compact ? "h-10" : "h-14",
        holdProgress > 0 && !opened && "ring-4 ring-amber-400/60",
        ringing && !opened && "ring-2 ring-red-300/80 shadow-md shadow-red-500/40",
      )}
      onClick={(e) => e.stopPropagation()}
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
      <span className="relative flex items-center gap-2">
        {opening ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <DoorOpen className="size-4" />
        )}
        {opened ? "Geöffnet" : opening ? "Öffne…" : "Tür (1 s halten)"}
      </span>
    </Button>
  );
}

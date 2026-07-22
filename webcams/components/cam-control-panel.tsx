"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Lightbulb,
  Plus,
  Minus,
  RotateCcw,
  Siren,
  Sun,
  Star,
  Save,
} from "lucide-react";
import { REOLINK_CAPS, type Cam } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface CamControlPanelProps {
  cam: Cam;
  className?: string;
  /** Wird vom Parent (FocusView) bereitgestellt – erzwingt Stream-Reconnect. */
  onReloadStream?: () => void;
}

interface SirenDialogState {
  open: boolean;
  durationSec: number;
}

export function CamControlPanel({ cam, className, onReloadStream }: CamControlPanelProps) {
  const caps = REOLINK_CAPS[cam.model];
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [spotlightOn, setSpotlightOn] = useState(false);
  const [siren, setSiren] = useState<SirenDialogState>({ open: false, durationSec: 3 });
  const [savePreset, setSavePreset] = useState<{ open: boolean; id: number } | null>(null);
  const [sirenActive, setSirenActive] = useState(false);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      try {
        const r = await fetch(`/api/cams/${cam.id}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        return await r.json();
      } catch (err) {
        toast(`Fehler: ${(err as Error).message}`, "error");
        throw err;
      }
    },
    [cam.id, toast],
  );

  // Hold-pattern für PTZ Buttons
  const useHold = (op: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      post("/ptz", { op }).catch(() => {});
    },
    onPointerUp: (e: React.PointerEvent) => {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      post("/ptz", { op: "Stop" }).catch(() => {});
    },
    onPointerCancel: () => {
      post("/ptz", { op: "Stop" }).catch(() => {});
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.buttons & 1) {
        post("/ptz", { op: "Stop" }).catch(() => {});
      }
    },
  });

  async function toggleSpotlight() {
    setBusy(true);
    try {
      await post("/spotlight", { on: !spotlightOn, brightness: 100 });
      setSpotlightOn((s) => !s);
      toast(`Spotlight ${spotlightOn ? "aus" : "an"}`, "success");
    } finally {
      setBusy(false);
    }
  }

  async function setIr(state: "Auto" | "On" | "Off") {
    await post("/ir", { state });
    toast(`Nachtsicht: ${state}`, "info");
  }

  async function fireSiren() {
    setBusy(true);
    try {
      const r = await post("/siren", { durationSec: siren.durationSec, confirmed: true });
      if (r.ok) {
        toast(`Sirene aktiv für ${siren.durationSec} s`, "success");
        setSirenActive(true);
        setTimeout(() => setSirenActive(false), siren.durationSec * 1000 + 500);
      }
    } catch {
      // toast already shown
    } finally {
      setBusy(false);
      setSiren({ ...siren, open: false });
    }
  }

  async function stopSiren() {
    try {
      const r = await fetch(`/api/cams/${cam.id}/siren`, { method: "DELETE" });
      if (r.ok) {
        setSirenActive(false);
        toast("Sirene gestoppt", "success");
      }
    } catch {
      /* ignore */
    }
  }

  async function presetGo(id: number) {
    await post("/preset", { op: "ToPos", presetId: id });
    toast(`Preset ${id} angefahren`, "info");
  }

  async function presetSave(id: number) {
    await post("/preset", { op: "SetPos", presetId: id });
    toast(`Preset ${id} gespeichert`, "success");
    setSavePreset(null);
  }

  // Keyboard shortcuts (active only when this panel is mounted, i.e. focus-mode)
  useEffect(() => {
    const ptzMap: Record<string, string> = {
      ArrowLeft: "Left",
      ArrowRight: "Right",
      ArrowUp: "Up",
      ArrowDown: "Down",
    };
    const heldKeys = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (ptzMap[e.key] && caps.ptz) {
        if (heldKeys.has(e.key)) return;
        heldKeys.add(e.key);
        e.preventDefault();
        post("/ptz", { op: ptzMap[e.key] }).catch(() => {});
        return;
      }
      if ((e.key === "+" || e.key === "=") && caps.zoom === "optical") {
        if (heldKeys.has("+")) return;
        heldKeys.add("+");
        e.preventDefault();
        post("/ptz", { op: "ZoomInc" }).catch(() => {});
        return;
      }
      if (e.key === "-" && caps.zoom === "optical") {
        if (heldKeys.has("-")) return;
        heldKeys.add("-");
        e.preventDefault();
        post("/ptz", { op: "ZoomDec" }).catch(() => {});
        return;
      }
      if (e.key === "l" && caps.spotlight) {
        e.preventDefault();
        toggleSpotlight();
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "s" && caps.siren) {
        e.preventDefault();
        setSiren({ open: true, durationSec: 3 });
        return;
      }
      // Presets Q/W/E/R = 1..4
      const presetKey = ["q", "w", "e", "r"].indexOf(e.key.toLowerCase());
      if (presetKey >= 0 && caps.ptz) {
        e.preventDefault();
        const id = presetKey + 1;
        if (e.shiftKey) {
          setSavePreset({ open: true, id });
        } else {
          presetGo(id);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      heldKeys.delete(e.key);
      if ((ptzMap[e.key] && caps.ptz) || ((e.key === "+" || e.key === "=" || e.key === "-") && caps.zoom === "optical")) {
        post("/ptz", { op: "Stop" }).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [caps, post]);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-tile/95 p-4 ring-1 ring-border backdrop-blur",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Steuerung</span>
          {onReloadStream && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onReloadStream}
              title="Stream neu verbinden"
              aria-label="Stream neu verbinden"
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
        </div>
        <Badge variant="info">{cam.model}</Badge>
      </div>

      {caps.ptz && (
        <div className="grid grid-cols-3 gap-1">
          <div />
          <Button variant="secondary" size="icon" {...useHold("Up")} aria-label="Hoch">
            <ArrowUp className="size-5" />
          </Button>
          <div />
          <Button variant="secondary" size="icon" {...useHold("Left")} aria-label="Links">
            <ArrowLeft className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" disabled aria-hidden>
            <Star className="size-4 text-foreground/30" />
          </Button>
          <Button variant="secondary" size="icon" {...useHold("Right")} aria-label="Rechts">
            <ArrowRight className="size-5" />
          </Button>
          <div />
          <Button variant="secondary" size="icon" {...useHold("Down")} aria-label="Runter">
            <ArrowDown className="size-5" />
          </Button>
          <div />
        </div>
      )}

      {caps.zoom === "optical" && (
        <div className="grid grid-cols-2 gap-1">
          <Button variant="secondary" {...useHold("ZoomDec")} aria-label="Zoom raus">
            <Minus className="size-4" /> Zoom −
          </Button>
          <Button variant="secondary" {...useHold("ZoomInc")} aria-label="Zoom rein">
            <Plus className="size-4" /> Zoom +
          </Button>
        </div>
      )}

      {caps.ptz && (
        <div className="grid grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((i) => (
            <Button
              key={i}
              variant="ghost"
              size="sm"
              onClick={() => presetGo(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                setSavePreset({ open: true, id: i });
              }}
              title={`Preset ${i} – Klick: anfahren · Rechtsklick / Shift+Q-R: speichern`}
            >
              <Star className="size-3" />
              {i}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {caps.spotlight && (
          <Button
            variant={spotlightOn ? "warning" : "secondary"}
            size="sm"
            onClick={toggleSpotlight}
            disabled={busy}
          >
            <Lightbulb className="size-4" />
            Spotlight
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-foreground/60">
          <span className="uppercase tracking-wider">IR</span>
          <Select
            defaultValue="Auto"
            className="h-8 w-24 px-2 text-xs"
            onChange={(e) => setIr(e.target.value as "Auto" | "On" | "Off")}
          >
            <option value="Auto">Auto</option>
            <option value="On">An</option>
            <option value="Off">Aus</option>
          </Select>
        </div>
      </div>

      {caps.siren && (
        <div className="flex gap-2">
          {sirenActive ? (
            <Button variant="destructive" size="sm" className="w-full pulse-ring" onClick={stopSiren}>
              <Siren className="size-4" />
              Sirene läuft – Stoppen
            </Button>
          ) : (
            <Button
              variant="warning"
              size="sm"
              className="w-full"
              onClick={() => setSiren({ open: true, durationSec: 3 })}
              disabled={busy}
            >
              <Siren className="size-4" />
              Sirene auslösen
            </Button>
          )}
        </div>
      )}

      <p className="text-[10px] uppercase tracking-wider text-foreground/40">
        Tasten: Pfeile · {caps.zoom === "optical" && "+/− · "}Q/W/E/R Preset · L Spotlight · Alt+S Sirene · Esc
      </p>

      <SirenDialog
        state={siren}
        cam={cam}
        onChange={setSiren}
        onConfirm={fireSiren}
      />

      {savePreset && (
        <ConfirmDialog
          open={savePreset.open}
          title={`Aktuelle Position als Preset ${savePreset.id} speichern?`}
          description="Bei späterem Aufruf des Presets fährt die Kamera automatisch zu dieser Position."
          confirmLabel="Speichern"
          onConfirm={() => presetSave(savePreset.id)}
          onCancel={() => setSavePreset(null)}
        >
          <div className="flex justify-center py-2">
            <Save className="size-8 text-focus" />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

function SirenDialog({
  state,
  cam,
  onChange,
  onConfirm,
}: {
  state: SirenDialogState;
  cam: Cam;
  onChange: (s: SirenDialogState) => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={state.open}
      title={`Sirene auf "${cam.name}" auslösen?`}
      description="Diese Aktion ist laut. Auch Nachbarn können sie hören."
      confirmLabel="Auslösen"
      destructive
      onConfirm={onConfirm}
      onCancel={() => onChange({ ...state, open: false })}
    >
      <div className="space-y-4">
        <Field label="Dauer">
          <Select
            value={state.durationSec}
            onChange={(e) => onChange({ ...state, durationSec: Number(e.target.value) })}
          >
            <option value={3}>3 Sekunden</option>
            <option value={5}>5 Sekunden</option>
            <option value={10}>10 Sekunden</option>
            <option value={20}>20 Sekunden</option>
            <option value={30}>30 Sekunden</option>
          </Select>
        </Field>
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-500/30">
          <Sun className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Cooldown:</strong> Nach dem Auslösen ist die Sirene für die in den
            Einstellungen festgelegte Zeit gesperrt. Während der Wiedergabe kannst du
            mit „Stoppen" sofort abbrechen.
          </p>
        </div>
      </div>
    </ConfirmDialog>
  );
}

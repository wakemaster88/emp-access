"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Loader2, Timer, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOOR_HOLD_PRESETS, isDoorHoldActive, type DoorHoldState } from "@/lib/door-hold";

export type { DoorHoldState };

/* ---------------------------------------------------------------------------
 * Tor offen halten (DoorBird): Das Tor schließt ~1 min nach jedem Impuls von
 * selbst; der Hub löst den Türöffner deshalb bis zum gewählten Endzeitpunkt
 * alle 50 s erneut aus. Hier: API-Aufrufe, Uhr, Badge, Dialog und Button –
 * genutzt im Webcam-Kontrollzentrum und auf der Kamera-Seite.
 * ------------------------------------------------------------------------- */

interface HoldResponse {
  ok: boolean;
  hold?: DoorHoldState;
  error?: string;
  /** Hub hat (noch) nicht geantwortet – Zielzustand steht, Task wird nachgeholt. */
  pending?: boolean;
}

async function callHold(cameraId: number, init: RequestInit): Promise<HoldResponse> {
  try {
    const res = await fetch(`/api/cameras/${cameraId}/door-hold`, init);
    const data = (await res.json().catch(() => ({}))) as HoldResponse;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}`, hold: data.hold };
    return data;
  } catch {
    return { ok: false, error: "Netzwerkfehler" };
  }
}

export function startDoorHold(cameraId: number, minutes: number): Promise<HoldResponse> {
  return callHold(cameraId, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minutes }),
  });
}

export function stopDoorHold(cameraId: number): Promise<HoldResponse> {
  return callHold(cameraId, { method: "DELETE" });
}

/**
 * Sekündlich tickende Jetzt-Zeit für Restzeit und „Impuls vor n s“.
 * 0 bis zum ersten Effekt – Date.now() ist im Render tabu (Hydration).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Erster Tick asynchron (kein setState direkt im Effekt), dann im Takt.
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function fmtRemaining(untilIso: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(untilIso).getTime() - now) / 1000));
  if (s < 60) return `noch ${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `noch ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `noch ${h} h ${rest} min` : `noch ${h} h`;
}

function fmtAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `vor ${s} s`;
  return `vor ${Math.floor(s / 60)} min`;
}

/**
 * Laufende Offenhaltung als Badge: Endzeit, Restzeit und – optional – der
 * letzte Impuls bzw. dessen Fehler. Rendert nichts, wenn nichts läuft.
 */
export function DoorHoldBadge({
  hold,
  now,
  showPulse = true,
  className,
}: {
  hold: DoorHoldState | null;
  now: number;
  showPulse?: boolean;
  className?: string;
}) {
  if (!now || !hold || !isDoorHoldActive(hold, now)) return null;
  const warn = !!hold.error;
  const pulse = hold.error
    ? `Impuls fehlgeschlagen: ${hold.error}`
    : hold.pulseAt
      ? `Impuls ${fmtAgo(hold.pulseAt, now)}`
      : "wartet auf Hub";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight text-white",
        warn ? "bg-rose-600/90" : "bg-emerald-600/90",
        className
      )}
      title={`Tor offen halten bis ${fmtClock(hold.until!)} Uhr · ${pulse}`}
    >
      {warn ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Timer className="h-3 w-3 shrink-0" />}
      <span className="truncate">
        Offen bis {fmtClock(hold.until!)} · {fmtRemaining(hold.until!, now)}
        {showPulse && <span className="opacity-80"> · {pulse}</span>}
      </span>
    </span>
  );
}

function DoorHoldDialog({
  open,
  onOpenChange,
  cameraName,
  busy,
  error,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cameraName: string;
  busy: boolean;
  error: string;
  onStart: (minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(30);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-emerald-600" />
            Tor offen halten – {cameraName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Das Tor schließt etwa eine Minute nach jedem Impuls von selbst. Der Hub löst den
            Türöffner deshalb bis zum Ende der gewählten Dauer alle 50 Sekunden erneut aus.
            Beenden geht jederzeit über dasselbe Symbol.
          </p>
          <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOOR_HOLD_PRESETS.map((p) => (
                <SelectItem key={p.minutes} value={String(p.minutes)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button onClick={() => onStart(minutes)} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Timer className="h-4 w-4" />}
              Offen halten
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Uhr-Symbol: nichts aktiv → Dialog mit Dauer; aktiv → sofort beenden.
 * `onChange` bekommt den Zustand aus der Antwort (Kontrollzentrum aktualisiert
 * sein Poll-Abbild, die Kamera-Seite lädt neu); Fehler gehen an `onError`.
 */
export function DoorHoldButton({
  cameraId,
  cameraName,
  hold,
  disabled,
  onChange,
  onError,
  className,
  activeClassName,
  iconClassName = "h-4 w-4",
  variant = "ghost",
  size = "icon",
}: {
  cameraId: number;
  cameraName: string;
  hold: DoorHoldState | null;
  disabled?: boolean;
  onChange?: (hold: DoorHoldState) => void;
  onError?: (message: string) => void;
  className?: string;
  /** Zusätzliche Klassen, solange die Offenhaltung läuft. */
  activeClassName?: string;
  iconClassName?: string;
  variant?: "ghost" | "secondary" | "outline";
  size?: "icon" | "sm";
}) {
  const now = useNow();
  const active = !!now && !!hold && isDoorHoldActive(hold, now);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const start = useCallback(
    async (minutes: number) => {
      setBusy(true);
      setDialogError("");
      const r = await startDoorHold(cameraId, minutes);
      setBusy(false);
      if (r.hold) onChange?.(r.hold);
      if (!r.ok) {
        setDialogError(r.error ?? "Fehler");
        return;
      }
      setDialogOpen(false);
      if (r.pending) onError?.("Hub hat noch nicht geantwortet – die Offenhaltung startet, sobald er den Auftrag abholt.");
    },
    [cameraId, onChange, onError]
  );

  const stop = useCallback(async () => {
    setBusy(true);
    const r = await stopDoorHold(cameraId);
    setBusy(false);
    if (r.hold) onChange?.(r.hold);
    if (!r.ok) onError?.(r.error ?? "Beenden fehlgeschlagen");
  }, [cameraId, onChange, onError]);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={cn(className, active && activeClassName)}
        title={active ? "Offen halten beenden" : "Tor offen halten"}
        aria-pressed={active}
        disabled={disabled || busy}
        onClick={() => {
          if (active) void stop();
          else {
            setDialogError("");
            setDialogOpen(true);
          }
        }}
      >
        {busy
          ? <Loader2 className={cn(iconClassName, "animate-spin")} />
          : active
            ? <TimerOff className={iconClassName} />
            : <Timer className={iconClassName} />}
      </Button>
      <DoorHoldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cameraName={cameraName}
        busy={busy}
        error={dialogError}
        onStart={start}
      />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Blinds,
  CircleDot,
  DoorOpen,
  Droplets,
  GitMerge,
  KeyRound,
  Lightbulb,
  Loader2,
  Play,
  Power,
  Square,
  ToggleRight,
  Umbrella,
  Volume2,
} from "lucide-react";
import { isLatchingSwitchDevice, visibleDeviceControls } from "@/lib/device-controls";
import type { DeviceControl } from "@/lib/device-controls";
import { cn } from "@/lib/utils";
import type { RoomDevice } from "@/components/raeume/types";
import type { DeviceStatus } from "@/components/raeume/status";
import { deviceMetaLabel, fmtAgo, shortDeviceName } from "@/components/raeume/shared";
import { Switch } from "@/components/ui/switch";

/** Symbol nach Geraeteart. Gibt das Element direkt zurueck, damit waehrend des
 *  Renderns keine Komponente in einer Variablen landet. */
function DeviceIcon({ device, className }: { device: RoomDevice; className?: string }) {
  if (device.type === "NUKI_SMARTLOCK" || device.type === "LOQED_SMARTLOCK") {
    return <KeyRound className={className} />;
  }
  if (device.type === "GARDENA_VALVE") return <Droplets className={className} />;
  if (device.type === "AUDIO_PLAYER" || device.category === "AUDIO") {
    return <Volume2 className={className} />;
  }
  if (device.category === "DREHKREUZ") return <GitMerge className={className} />;
  if (device.category === "TUER") return <DoorOpen className={className} />;
  if (device.category === "BELEUCHTUNG") return <Lightbulb className={className} />;
  if (device.category === "SCHALTER") return <ToggleRight className={className} />;
  if (device.category === "SENSOR") return <Activity className={className} />;
  if (device.category === "MARKISE") return <Umbrella className={className} />;
  if (device.category === "ROLLTOR") return <Blinds className={className} />;
  if (device.category === "TASTER") return <CircleDot className={className} />;
  return <Power className={className} />;
}

function ControlIcon({ control, className }: { control: DeviceControl; className?: string }) {
  if (control.role === "danger") return <AlertTriangle className={className} />;
  if (control.action === "stop") return <Square className={className} />;
  if (control.action === "reset" || control.action === "deactivate" || control.action === "close") {
    return <Power className={className} />;
  }
  return <Play className={className} />;
}

/**
 * Ein Geraet im Raum: Zustand links, Bedienung rechts. Welche Knoepfe ein
 * Geraet bekommt, entscheidet `visibleDeviceControls` – dieselbe Quelle, die
 * auch Monitor und Mitarbeiter-PWA nutzen.
 */
export function DeviceRow({
  device,
  roomName,
  status,
  nowMs,
  readonly,
  onAction,
}: {
  device: RoomDevice;
  /** Raum der Karte; wird im angezeigten Namen weggelassen. */
  roomName?: string;
  status: DeviceStatus | undefined;
  nowMs: number;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const controls = visibleDeviceControls(device, status?.output);
  const isLatching = isLatchingSwitchDevice(device);
  // Hue meldet keinen Status in die Cloud: dort zaehlt der letzte Befehl.
  const reported = status ? status.output === true : device.type === "HUE_LIGHT" && device.task === 1;
  // Schalter springen sofort um und warten nicht auf die naechste Abfrage.
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), 10_000);
    return () => clearTimeout(t);
  }, [pending]);
  const on = pending ?? reported;
  const label = roomName ? shortDeviceName(device.name, roomName) : device.name;
  const reachable = !status || status.online;

  async function toggle(next: boolean) {
    setPending(next);
    setBusy(next ? "open" : "reset");
    setError("");
    const message = await onAction(device, next ? "open" : "reset");
    setBusy(null);
    if (message) {
      setPending(null);
      setError(message);
    }
  }

  async function run(action: string) {
    setBusy(action);
    setError("");
    const message = await onAction(device, action);
    setBusy(null);
    if (message) setError(message);
  }

  return (
    <div className="rounded-md border border-border bg-white p-2 dark:border-border dark:bg-card/40">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded",
            on
              ? "bg-warning/10 text-warning "
              : "bg-muted text-muted-foreground/70 dark:bg-muted",
          )}
          title={status ? (status.online ? `erreichbar (${status.source})` : "nicht erreichbar") : undefined}
        >
          <DeviceIcon device={device} className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className="flex flex-wrap items-center gap-x-1.5 break-words text-sm font-medium leading-snug text-foreground/90"
            title={label !== device.name ? device.name : undefined}
          >
            {label}
            {!device.isActive && (
              <span className="shrink-0 text-[10px] font-normal text-muted-foreground/70">außer Betrieb</span>
            )}
          </p>
          <p className="truncate text-[11px] text-muted-foreground/70">
            {deviceMetaLabel(device.type, device.category)}
            {status && !status.online && <span className="ml-1.5 text-warning">· nicht erreichbar</span>}
            {status?.power != null && status.power > 0 && (
              <span className="ml-1.5">· {Math.round(status.power)} W</span>
            )}
            {!status && device.lastUpdate && (
              <span className="ml-1.5">· zuletzt {fmtAgo(device.lastUpdate, nowMs)}</span>
            )}
          </p>
        </div>

        {isLatching && !readonly && (
          <span className="flex shrink-0 items-center gap-2">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" />}
            <span className={cn("text-[11px] tabular-nums", on ? "text-warning" : "text-muted-foreground/70")}>
              {status || pending !== null || device.type === "HUE_LIGHT" ? (on ? "an" : "aus") : ""}
            </span>
            <Switch
              checked={on}
              disabled={busy !== null || !reachable}
              onCheckedChange={(next) => void toggle(next)}
              aria-label={`${device.name} ${on ? "ausschalten" : "einschalten"}`}
            />
          </span>
        )}

        {!isLatching && !readonly && controls.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            {controls.map((control) => {
              const active = busy === control.action;
              return (
                <button
                  key={control.action}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(control.action)}
                  title={control.label}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                    control.role === "danger"
                      ? "bg-destructive/10 text-destructive hover:bg-destructive/10 "
                      : control.role === "primary"
                        ? "bg-primary text-white hover:bg-primary/90"
                        : "bg-muted text-muted-foreground hover:bg-accent dark:bg-muted dark:text-foreground/80",
                  )}
                >
                  {active ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ControlIcon control={control} className="h-3 w-3" />
                  )}
                  {control.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {status?.readings && status.readings.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-9">
          {status.readings.map((reading) => (
            <span
              key={reading.kind + reading.label}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px]",
                reading.emphasis === "alert"
                  ? "bg-destructive/12 text-destructive"
                  : reading.emphasis === "warn"
                    ? "bg-warning/10 text-warning "
                    : "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground",
              )}
            >
              {reading.label} {reading.value}
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-1.5 pl-9 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

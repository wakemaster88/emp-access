"use client";

import { useState } from "react";
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
import { deviceMetaLabel, fmtAgo } from "@/components/raeume/shared";

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
  status,
  nowMs,
  readonly,
  onAction,
}: {
  device: RoomDevice;
  status: DeviceStatus | undefined;
  nowMs: number;
  readonly: boolean;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const controls = visibleDeviceControls(device, status?.output);
  const isLatching = isLatchingSwitchDevice(device);
  const on = status?.output === true;

  async function run(action: string) {
    setBusy(action);
    setError("");
    const message = await onAction(device, action);
    setBusy(null);
    if (message) setError(message);
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded",
            on
              ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
              : "bg-slate-100 text-slate-400 dark:bg-slate-800",
          )}
        >
          <DeviceIcon device={device} className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
            {device.name}
            {!device.isActive && (
              <span className="shrink-0 text-[10px] font-normal text-slate-400">außer Betrieb</span>
            )}
          </p>
          <p className="truncate text-[11px] text-slate-400">
            {deviceMetaLabel(device.type, device.category)}
            {status && status.source !== "unavailable" && isLatching && (
              <span className={cn("ml-1.5", on ? "text-amber-600 dark:text-amber-400" : "")}>
                · {on ? "an" : "aus"}
              </span>
            )}
            {status?.power != null && status.power > 0 && (
              <span className="ml-1.5">· {Math.round(status.power)} W</span>
            )}
            {!status && device.lastUpdate && (
              <span className="ml-1.5">· zuletzt {fmtAgo(device.lastUpdate, nowMs)}</span>
            )}
          </p>
        </div>

        {status && (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              status.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
            )}
            title={status.online ? `erreichbar (${status.source})` : "nicht erreichbar"}
          />
        )}

        {!readonly && controls.length > 0 && (
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
                      ? "bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400"
                      : control.role === "primary"
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300",
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
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                  : reading.emphasis === "warn"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              )}
            >
              {reading.label} {reading.value}
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-1.5 pl-9 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}

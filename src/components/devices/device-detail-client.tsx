"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, DoorOpen, ToggleRight, RotateCcw, Loader2, Pencil,
  Power, PowerOff, Activity, Wifi, WifiOff, Zap, RefreshCw, Lock, LockOpen,
  Droplets, Square, Battery, BatteryLow, ArrowUpFromLine, ArrowDownToLine,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  coverActionLabels, coverMotionLabel, isCoverDevice, type CoverMotion,
} from "@/lib/cover-constants";
import type { SensorReading } from "@/lib/shelly-sensor";
import { SensorReadings } from "./sensor-readings";
import { EditDeviceDialog, type DeviceData, type AreaOption, type CameraOption } from "./edit-device-dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CoverStatus {
  motion: CoverMotion;
  position: number | null;
  upOn: boolean | null;
  downOn: boolean | null;
  configured: boolean;
  mode: "cover" | "relays";
}

interface ShellyStatus {
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
  cover?: CoverStatus;
  /// Messwerte des Geräts (Türkontakt, Riegel, Temperatur, Batterie …).
  readings?: SensorReading[];
}

interface GardenaStatus {
  online: boolean;
  activity: string | null;
  watering: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  rfLinkLevel: number | null;
  modelType: string | null;
  source: "cloud" | "unavailable";
}

// GARDENA-Bewässerungsdauern (Minuten) fuer den Dauer-Picker.
const GARDENA_DURATIONS = [5, 15, 30, 60] as const;

function gardenaActivityLabel(activity: string | null): string {
  switch (activity) {
    case "CLOSED": return "Geschlossen";
    case "MANUAL_WATERING": return "Bewässert (manuell)";
    case "SCHEDULED_WATERING": return "Bewässert (Zeitplan)";
    case "PAUSED": return "Pausiert";
    default: return activity ?? "Unbekannt";
  }
}

interface Props {
  device: DeviceData & { task: number };
  areas?: AreaOption[];
  cameras?: CameraOption[];
}

/**
 * Fahrtrichtung eines Antriebs. "Beide Richtungen aktiv" ist ein Alarmzustand:
 * Dann liegt Spannung auf beiden Wicklungsrichtungen und der Antrieb sollte
 * sofort gestoppt werden.
 */
function CoverMotionBadge({
  cover,
  category,
}: {
  cover?: CoverStatus;
  category: string | null;
}) {
  if (!cover) return null;
  // Die Position kennt nur ein kalibrierter Antrieb im Cover-Profil.
  const position = cover.position != null ? ` · ${cover.position} %` : "";
  const label = coverMotionLabel(cover.motion, category) + position;

  if (cover.motion === "conflict") {
    return (
      <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 gap-1.5 text-xs">
        <AlertTriangle className="h-3 w-3" /> {label} – sofort stoppen
      </Badge>
    );
  }
  if (cover.motion === "opening" || cover.motion === "closing") {
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1.5 text-xs">
        {cover.motion === "opening"
          ? <ArrowUpFromLine className="h-3 w-3" />
          : <ArrowDownToLine className="h-3 w-3" />}
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1.5 text-slate-500 text-xs">
      <Square className="h-3 w-3" /> {label}
    </Badge>
  );
}

// ─── Action definitions ───────────────────────────────────────────────────────

const ACCESS_ACTIONS = [
  { key: "emergency",  label: "NOT-AUF",     icon: AlertTriangle, base: "bg-rose-600 hover:bg-rose-700 text-white",    activeTask: 2 },
  { key: "open",       label: "Öffnen",       icon: DoorOpen,      base: "bg-emerald-600 hover:bg-emerald-700 text-white", activeTask: 1 },
  { key: "deactivate", label: "Deaktivieren", icon: ToggleRight,   base: "bg-amber-500 hover:bg-amber-600 text-white",   activeTask: 3 },
  { key: "reset",      label: "Reset",        icon: RotateCcw,     base: "bg-slate-600 hover:bg-slate-700 text-white",   activeTask: 0 },
];
const TUER_ACTIONS = ACCESS_ACTIONS.filter((a) => a.key !== "emergency");
// Nuki Smart Lock: nur Öffnen/Abschließen – Web-API kennt kein "deaktivieren"
// und kein "reset", LOCK ist gleich Abschließen.
const NUKI_ACTIONS = [
  { key: "open",       label: "Öffnen",      icon: DoorOpen, base: "bg-emerald-600 hover:bg-emerald-700 text-white", activeTask: 1 },
  { key: "deactivate", label: "Abschließen", icon: Lock,     base: "bg-slate-700 hover:bg-slate-800 text-white",     activeTask: 3 },
];
// LOQED: drei echte Riegelzustände. "Entriegeln" ist die Tagverriegelung –
// Tür zu, aber von innen per Klinke zu öffnen.
const LOQED_ACTIONS = [
  { key: "open",       label: "Öffnen",      icon: DoorOpen,  base: "bg-emerald-600 hover:bg-emerald-700 text-white", activeTask: 1 },
  { key: "reset",      label: "Entriegeln",  icon: LockOpen,  base: "bg-amber-500 hover:bg-amber-600 text-white",     activeTask: 0 },
  { key: "deactivate", label: "Abschließen", icon: Lock,      base: "bg-slate-700 hover:bg-slate-800 text-white",     activeTask: 3 },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function DeviceDetailClient({ device, areas, cameras }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [task, setTask] = useState(device.task);

  // Shelly live status
  const isShelly = device.type === "SHELLY";
  const isNuki = device.type === "NUKI_SMARTLOCK";
  const isLoqed = device.type === "LOQED_SMARTLOCK";
  const isGardena = device.type === "GARDENA_VALVE";
  const isSwitch = device.category === "SCHALTER" || device.category === "BELEUCHTUNG";
  const isSensor = device.category === "SENSOR";
  const isDrehkreuz = device.category === "DREHKREUZ";
  const isTuer = device.category === "TUER";
  const isCover = isCoverDevice(device);

  const [shellyStatus, setShellyStatus] = useState<ShellyStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [gardenaStatus, setGardenaStatus] = useState<GardenaStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(isShelly || isGardena);

  const fetchShellyStatus = useCallback(async () => {
    if (!isShelly) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/devices/${device.id}/shelly-status`);
      if (res.ok) setShellyStatus(await res.json());
    } finally {
      setStatusLoading(false);
    }
  }, [device.id, isShelly]);

  const fetchGardenaStatus = useCallback(async () => {
    if (!isGardena) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/devices/${device.id}/gardena-status`);
      if (res.ok) setGardenaStatus(await res.json());
    } finally {
      setStatusLoading(false);
    }
  }, [device.id, isGardena]);

  useEffect(() => {
    fetchShellyStatus();
    fetchGardenaStatus();
  }, [fetchShellyStatus, fetchGardenaStatus]);

  // Waehrend einer Fahrt haeufiger nachfragen, damit sichtbar wird, wann der
  // Antrieb steht. Danach ruht die Abfrage wieder.
  const motion = shellyStatus?.cover?.motion;
  useEffect(() => {
    if (motion !== "opening" && motion !== "closing") return;
    const timer = setInterval(fetchShellyStatus, 3000);
    return () => clearInterval(timer);
  }, [motion, fetchShellyStatus]);

  // ─── Action handler ─────────────────────────────────────────────────────────

  async function handleAction(action: string, minutes?: number) {
    setLoading(minutes ? `open:${minutes}` : action);
    setActionError(null);

    // Optimistic update for Shelly switch
    if (isShelly && isSwitch) {
      setShellyStatus((prev) => prev ? { ...prev, output: action === "open" } : prev);
    }
    // Optimistic update for cover drives
    if (isCover) {
      const nextMotion: CoverMotion =
        action === "open" ? "opening" : action === "close" ? "closing" : "idle";
      setShellyStatus((prev) =>
        prev?.cover ? { ...prev, cover: { ...prev.cover, motion: nextMotion } } : prev
      );
    }
    // Optimistic update for GARDENA valve
    if (isGardena) {
      setGardenaStatus((prev) => prev
        ? { ...prev, watering: action === "open", activity: action === "open" ? "MANUAL_WATERING" : "CLOSED" }
        : prev);
    }

    try {
      const res = await fetch(`/api/devices/${device.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(minutes ? { action, minutes } : { action }),
      });
      if (res.ok) {
        const data = await res.json();
        setTask(data.task);
        // `sent: false` heisst: Befehl wurde angenommen, aber nicht zugestellt.
        if (data.sent === false) {
          setActionError(data.error ?? "Gerät nicht erreichbar – Befehl kam nicht an");
        }
        router.refresh();
        // Re-fetch real status after short delay
        if (isShelly) setTimeout(fetchShellyStatus, 1500);
        if (isGardena) setTimeout(fetchGardenaStatus, 2500);
      } else {
        const data = await res.json().catch(() => null);
        setActionError(data?.error ?? "Aktion fehlgeschlagen");
        // Revert optimistic update
        fetchShellyStatus();
        fetchGardenaStatus();
      }
    } catch {
      setActionError("Netzwerkfehler");
      fetchShellyStatus();
    } finally {
      setLoading(null);
    }
  }

  // ─── Shelly status badges ────────────────────────────────────────────────────

  const ShellyStatusBadges = isShelly ? (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {statusLoading && !shellyStatus ? (
        <Badge variant="secondary" className="gap-1.5 animate-pulse text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Status lädt…
        </Badge>
      ) : shellyStatus ? (
        <>
          {shellyStatus.online ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1.5 text-xs">
              <Wifi className="h-3 w-3" /> Online
              <span className="opacity-50 text-[10px]">({shellyStatus.source})</span>
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5 text-slate-400 text-xs">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          )}

          {isCover ? (
            <CoverMotionBadge cover={shellyStatus.cover} category={device.category ?? null} />
          ) : isSensor ? (
            // Ein Sensor hat keinen Ausgang. Steht er auf demselben Shelly wie
            // ein Schaltkanal, waere dessen Zustand hier irrefuehrend.
            null
          ) : shellyStatus.output === true ? (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1.5 text-xs">
              <Power className="h-3 w-3" />
              {device.category === "BELEUCHTUNG" ? "Eingeschaltet" : "Ein"}
            </Badge>
          ) : shellyStatus.output === false ? (
            <Badge variant="secondary" className="gap-1.5 text-slate-500 text-xs">
              <PowerOff className="h-3 w-3" />
              {device.category === "BELEUCHTUNG" ? "Ausgeschaltet" : "Aus"}
            </Badge>
          ) : null}

          {/* Offline sind die letzten Messwerte veraltet – dann sagt "Offline"
              mehr aus als ein alter Wert. */}
          {shellyStatus.online && shellyStatus.readings && (
            <SensorReadings readings={shellyStatus.readings} />
          )}

          {shellyStatus.power !== undefined && shellyStatus.power > 0.5 && (
            <Badge variant="outline" className="gap-1 text-xs text-slate-500">
              <Zap className="h-3 w-3 text-amber-500" />
              {shellyStatus.power.toFixed(1)} W
            </Badge>
          )}

          <button
            onClick={fetchShellyStatus}
            disabled={statusLoading}
            className="text-slate-300 hover:text-slate-500 transition-colors"
            title="Status aktualisieren"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", statusLoading && "animate-spin")} />
          </button>
        </>
      ) : (
        <Badge variant="secondary" className="gap-1.5 text-slate-400 text-xs">
          <WifiOff className="h-3 w-3" /> Nicht erreichbar
        </Badge>
      )}
    </div>
  ) : null;

  // ─── GARDENA status badges ────────────────────────────────────────────────────

  const gardenaBattery = gardenaStatus?.batteryLevel;
  const hasBattery = gardenaStatus?.batteryState != null && gardenaStatus.batteryState !== "NO_BATTERY";

  const GardenaStatusBadges = isGardena ? (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {statusLoading && !gardenaStatus ? (
        <Badge variant="secondary" className="gap-1.5 animate-pulse text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Status lädt…
        </Badge>
      ) : gardenaStatus && gardenaStatus.source !== "unavailable" ? (
        <>
          {gardenaStatus.online ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1.5 text-xs">
              <Wifi className="h-3 w-3" /> Online
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5 text-slate-400 text-xs">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          )}

          {gardenaStatus.watering ? (
            <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 gap-1.5 text-xs">
              <Droplets className="h-3 w-3" /> {gardenaActivityLabel(gardenaStatus.activity)}
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5 text-slate-500 text-xs">
              <Square className="h-3 w-3" /> {gardenaActivityLabel(gardenaStatus.activity)}
            </Badge>
          )}

          {hasBattery && gardenaBattery != null && (
            <Badge variant="outline" className={cn(
              "gap-1 text-xs",
              gardenaBattery < 20 ? "text-rose-600 dark:text-rose-400" : "text-slate-500",
            )}>
              {gardenaBattery < 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />}
              {gardenaBattery}%
            </Badge>
          )}

          <button
            onClick={fetchGardenaStatus}
            disabled={statusLoading}
            className="text-slate-300 hover:text-slate-500 transition-colors"
            title="Status aktualisieren"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", statusLoading && "animate-spin")} />
          </button>
        </>
      ) : (
        <Badge variant="secondary" className="gap-1.5 text-slate-400 text-xs">
          <WifiOff className="h-3 w-3" /> Nicht erreichbar
        </Badge>
      )}
    </div>
  ) : null;

  // ─── Buttons ─────────────────────────────────────────────────────────────────

  const ActionButtons = (() => {
    // Sensor: no controls
    if (isSensor) {
      return (
        <span className="flex items-center gap-1.5 text-xs text-slate-400 px-1 italic">
          <Activity className="h-3.5 w-3.5" /> Sensor – nur Anzeige
        </span>
      );
    }

    // GARDENA valve / pump: Dauer-Picker + Stopp
    if (isGardena) {
      const watering = gardenaStatus?.watering === true;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Bewässern:</span>
          {GARDENA_DURATIONS.map((min) => (
            <Button
              key={min}
              size="sm"
              onClick={() => handleAction("open", min)}
              disabled={loading !== null}
              className="bg-sky-600 hover:bg-sky-700 text-white gap-1.5"
            >
              {loading === `open:${min}`
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Droplets className="h-4 w-4" />}
              {min} Min
            </Button>
          ))}
          <Button
            size="sm"
            onClick={() => handleAction("reset")}
            disabled={loading !== null || (gardenaStatus != null && !watering)}
            className={cn(
              "gap-1.5",
              watering
                ? "bg-slate-700 hover:bg-slate-800 text-white"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700",
            )}
          >
            {loading === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Stopp
          </Button>
        </div>
      );
    }

    // Antrieb mit zwei Fahrtrichtungen (Markise, Rolltor)
    if (isCover) {
      const cover = shellyStatus?.cover;
      const labels = coverActionLabels(device.category);
      const moving = cover?.motion === "opening" || cover?.motion === "closing";

      if (cover && !cover.configured) {
        return (
          <span className="flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <Settings2 className="h-3.5 w-3.5 shrink-0" />
            Kanäle für Auf und Zu fehlen – bitte unter „Bearbeiten“ zuordnen.
          </span>
        );
      }

      return (
        <>
          <Button
            size="sm"
            onClick={() => handleAction("open")}
            disabled={loading !== null}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading === "open"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ArrowUpFromLine className="h-4 w-4" />}
            {labels.open}
          </Button>

          <Button
            size="sm"
            onClick={() => handleAction("stop")}
            disabled={loading !== null}
            className={cn(
              "gap-1.5",
              moving
                ? "bg-slate-700 hover:bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700",
            )}
          >
            {loading === "stop"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Square className="h-4 w-4" />}
            Stopp
          </Button>

          <Button
            size="sm"
            onClick={() => handleAction("close")}
            disabled={loading !== null}
            className="gap-1.5 bg-sky-700 hover:bg-sky-800 text-white"
          >
            {loading === "close"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ArrowDownToLine className="h-4 w-4" />}
            {labels.close}
          </Button>
        </>
      );
    }

    // Shelly switch / light
    if (isShelly && isSwitch) {
      const isOn  = shellyStatus?.output === true;
      const isOff = shellyStatus?.output === false || shellyStatus?.output === null;
      const unknown = !shellyStatus || statusLoading;

      return (
        <>
          <Button
            size="sm"
            onClick={() => handleAction("open")}
            disabled={loading !== null || (isOn && !unknown)}
            className={cn(
              "gap-1.5 transition-all",
              isOn
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 cursor-default opacity-60"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            )}
          >
            {loading === "open" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            Einschalten
          </Button>

          <Button
            size="sm"
            onClick={() => handleAction("reset")}
            disabled={loading !== null || (isOff && !unknown)}
            className={cn(
              "gap-1.5 transition-all",
              isOff && !unknown
                ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700 cursor-default opacity-60"
                : "bg-slate-700 hover:bg-slate-800 text-white"
            )}
          >
            {loading === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />}
            Ausschalten
          </Button>
        </>
      );
    }

    // Access control (Pi / Schlösser)
    const actions = isLoqed
      ? LOQED_ACTIONS
      : isNuki
      ? NUKI_ACTIONS
      : isDrehkreuz
        ? ACCESS_ACTIONS
        : isTuer
          ? TUER_ACTIONS
          : [];
    return (
      <>
        {actions.map((a) => {
          const Icon = a.icon;
          const isActive = task === a.activeTask && a.key !== "reset";
          return (
            <Button
              key={a.key}
              size="sm"
              onClick={() => handleAction(a.key)}
              disabled={loading !== null}
              className={cn(a.base, isActive && "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-950 ring-current")}
            >
              {loading === a.key ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Icon className="h-4 w-4 mr-1.5" />}
              {a.label}
            </Button>
          );
        })}
      </>
    );
  })();

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {ShellyStatusBadges}
      {GardenaStatusBadges}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
          <Pencil className="h-4 w-4" />
          Bearbeiten
        </Button>
        {ActionButtons}
      </div>
      {actionError && (
        <p
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-3 py-2 text-xs text-rose-700 dark:text-rose-400"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {actionError}
        </p>
      )}
      <EditDeviceDialog
        device={editing ? device : null}
        areas={areas}
        cameras={cameras}
        onClose={() => setEditing(false)}
      />
    </>
  );
}

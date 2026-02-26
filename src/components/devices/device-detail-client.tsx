"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, DoorOpen, ToggleRight, RotateCcw, Loader2, Pencil,
  Power, PowerOff, Activity, Wifi, WifiOff, Zap, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EditDeviceDialog, type DeviceData, type AreaOption } from "./edit-device-dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ShellyStatus {
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
}

interface Props {
  device: DeviceData & { task: number };
  areas?: AreaOption[];
}

// ─── Action definitions ───────────────────────────────────────────────────────

const ACCESS_ACTIONS = [
  { key: "emergency",  label: "NOT-AUF",     icon: AlertTriangle, base: "bg-rose-600 hover:bg-rose-700 text-white",    activeTask: 2 },
  { key: "open",       label: "Öffnen",       icon: DoorOpen,      base: "bg-emerald-600 hover:bg-emerald-700 text-white", activeTask: 1 },
  { key: "deactivate", label: "Deaktivieren", icon: ToggleRight,   base: "bg-amber-500 hover:bg-amber-600 text-white",   activeTask: 3 },
  { key: "reset",      label: "Reset",        icon: RotateCcw,     base: "bg-slate-600 hover:bg-slate-700 text-white",   activeTask: 0 },
];
const TUER_ACTIONS = ACCESS_ACTIONS.filter((a) => a.key !== "emergency");

// ─── Component ───────────────────────────────────────────────────────────────

export function DeviceDetailClient({ device, areas }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [task, setTask] = useState(device.task);

  // Shelly live status
  const isShelly = device.type === "SHELLY";
  const isSwitch = device.category === "SCHALTER" || device.category === "BELEUCHTUNG";
  const isSensor = device.category === "SENSOR";
  const isDrehkreuz = device.category === "DREHKREUZ";
  const isTuer = device.category === "TUER";

  const [shellyStatus, setShellyStatus] = useState<ShellyStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(isShelly);

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

  useEffect(() => {
    fetchShellyStatus();
  }, [fetchShellyStatus]);

  // ─── Action handler ─────────────────────────────────────────────────────────

  async function handleAction(action: string) {
    setLoading(action);

    // Optimistic update for Shelly switch
    if (isShelly && isSwitch) {
      setShellyStatus((prev) => prev ? { ...prev, output: action === "open" } : prev);
    }

    try {
      const res = await fetch(`/api/devices/${device.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setTask(data.task);
        router.refresh();
        // Re-fetch real status after short delay
        if (isShelly) setTimeout(fetchShellyStatus, 1500);
      } else {
        // Revert optimistic update
        fetchShellyStatus();
      }
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

          {shellyStatus.output === true ? (
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

    // Access control (Pi)
    const actions = isDrehkreuz ? ACCESS_ACTIONS : isTuer ? TUER_ACTIONS : [];
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
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
          <Pencil className="h-4 w-4" />
          Bearbeiten
        </Button>
        {ActionButtons}
      </div>
      <EditDeviceDialog
        device={editing ? device : null}
        areas={areas}
        onClose={() => setEditing(false)}
      />
    </>
  );
}

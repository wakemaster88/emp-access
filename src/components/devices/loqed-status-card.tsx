"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Battery, BatteryLow, BatteryWarning, BatteryFull,
  Lock, Unlock, KeyRound, RefreshCw, Loader2, AlertTriangle,
  Activity, Clock, User as UserIcon, DoorOpen,
} from "lucide-react";
import { cn, fmtDateTime } from "@/lib/utils";
import { loqedBoltStateLabel } from "@/lib/loqed-constants";

interface LoqedSystemInfo {
  boltState?: string | null;
  batteryPercentage?: number | null;
  batteryType?: string | null;
  modelName?: string | null;
  supportedLockStates?: string[] | null;
  lockDirection?: string | null;
  mortiseLockType?: string | null;
  guestAccessMode?: boolean | null;
  partyMode?: boolean | null;
  twistAssist?: boolean | null;
  refreshedAt?: string | null;
  syncedAt?: string | null;
  importedAt?: string | null;
  lastEvent?: {
    boltState?: string | null;
    eventType?: string | null;
    keyName?: string | null;
    at?: string | null;
  } | null;
}

interface Props {
  deviceId: number;
  initialInfo: LoqedSystemInfo | null;
  lastUpdate: string | null;
}

function boltMeta(state: string | null | undefined) {
  switch (state) {
    case "night_lock":
      return { icon: Lock, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };
    case "day_lock":
      return { icon: Unlock, cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" };
    case "open":
      return { icon: DoorOpen, cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
    default:
      return { icon: Activity, cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };
  }
}

/**
 * LOQED meldet -1, wenn das Schloss offline ist. Das ist keine leere Batterie,
 * sondern eine fehlende Angabe.
 */
function batteryMeta(charge: number | null | undefined) {
  if (charge == null || charge < 0) {
    return { icon: Battery, text: "—", cls: "text-slate-600 dark:text-slate-400 bg-slate-500/10", barCls: "bg-slate-400", pct: null };
  }
  const pct = Math.max(0, Math.min(100, Math.round(charge)));
  if (pct < 15) return { icon: BatteryWarning, text: `${pct}%`, cls: "text-rose-600 dark:text-rose-400 bg-rose-500/10", barCls: "bg-rose-500", pct };
  if (pct < 30) return { icon: BatteryLow, text: `${pct}%`, cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10", barCls: "bg-amber-500", pct };
  if (pct >= 80) return { icon: BatteryFull, text: `${pct}%`, cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", barCls: "bg-emerald-500", pct };
  return { icon: Battery, text: `${pct}%`, cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", barCls: "bg-emerald-500", pct };
}

/** Bauart der Tuer im Klartext – erklaert, warum "Öffnen" moeglich ist. */
const MORTISE_LABELS: Record<string, string> = {
  cylinder_operated_no_handle_on_the_outside: "Zylinder, außen ohne Klinke",
  cylinder_operated_handle_on_the_outside: "Zylinder, außen mit Klinke",
};

export function LoqedStatusCard({ deviceId, initialInfo, lastUpdate }: Props) {
  const [info, setInfo] = useState<LoqedSystemInfo | null>(initialInfo);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/loqed-refresh`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setInfo(data.systemInfo as LoqedSystemInfo);
      else setError(data.error ?? `Fehler ${res.status}`);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setRefreshing(false);
    }
  }

  const bolt = boltMeta(info?.boltState);
  const BoltIcon = bolt.icon;
  const bat = batteryMeta(info?.batteryPercentage);
  const BatIcon = bat.icon;
  const refreshedAt = info?.refreshedAt ?? info?.syncedAt ?? info?.importedAt ?? lastUpdate;
  const canOpen = info?.supportedLockStates?.includes("open") ?? null;

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-5 pb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400 flex items-center justify-center">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                LOQED Status
                {info?.modelName && (
                  <span className="ml-1.5 text-xs font-normal text-slate-500">· {info.modelName}</span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400">
                Aktualisiert: {refreshedAt ? fmtDateTime(refreshedAt) : "—"}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            className="h-8 gap-1.5"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Aktualisieren
          </Button>
        </div>

        {error && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-xs px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", bolt.cls)}>
                <BoltIcon className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Riegel</p>
            </div>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight">
              {loqedBoltStateLabel(info?.boltState)}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", bat.cls)}>
                <BatIcon className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Batterie</p>
            </div>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight tabular-nums">
              {bat.text}
            </p>
            {bat.pct !== null && (
              <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div className={cn("h-full transition-all", bat.barCls)} style={{ width: `${bat.pct}%` }} />
              </div>
            )}
            {info?.batteryType && (
              <p className="text-[10px] text-slate-400">{info.batteryType}</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="h-6 w-6 rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-400 flex items-center justify-center">
                <DoorOpen className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Bauart</p>
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              {info?.mortiseLockType
                ? MORTISE_LABELS[info.mortiseLockType] ?? info.mortiseLockType
                : "—"}
            </p>
            {canOpen === false && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Öffnen wird nicht unterstützt
              </p>
            )}
          </div>
        </div>

        {info?.batteryPercentage != null && info.batteryPercentage >= 0 && info.batteryPercentage < 30 && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-700 dark:text-rose-300">
              <p className="font-semibold">Batterie schwach</p>
              <p className="opacity-90">
                Bei leerer Batterie lässt sich die Tür nicht mehr aus EMP öffnen. Batterien bald wechseln.
              </p>
            </div>
          </div>
        )}

        {info?.lastEvent && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5 inline-flex items-center gap-1">
              <Activity className="h-3 w-3" /> Letztes Ereignis
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1">
                <Clock className="h-3 w-3 text-slate-400" />
                {info.lastEvent.at ? fmtDateTime(info.lastEvent.at) : "—"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-700 dark:text-slate-300">
                {loqedBoltStateLabel(info.lastEvent.boltState)}
              </span>
              {info.lastEvent.keyName && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-700 dark:text-slate-300 inline-flex items-center gap-0.5">
                    <UserIcon className="h-3 w-3 text-slate-400" />
                    {info.lastEvent.keyName}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {!info && (
          <p className="text-xs text-slate-400 italic text-center py-4">
            Noch keine LOQED-Daten. Über &bdquo;Aktualisieren&ldquo; den aktuellen Zustand abrufen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

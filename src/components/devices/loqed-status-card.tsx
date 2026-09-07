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
      return { icon: Lock, cls: "bg-success/12 text-success" };
    case "day_lock":
      return { icon: Unlock, cls: "bg-info/12 text-info" };
    case "open":
      return { icon: DoorOpen, cls: "bg-warning/14 text-warning" };
    default:
      return { icon: Activity, cls: "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground" };
  }
}

/**
 * LOQED meldet -1, wenn das Schloss offline ist. Das ist keine leere Batterie,
 * sondern eine fehlende Angabe.
 */
function batteryMeta(charge: number | null | undefined) {
  if (charge == null || charge < 0) {
    return { icon: Battery, text: "—", cls: "text-muted-foreground bg-slate-500/10", barCls: "bg-slate-400", pct: null };
  }
  const pct = Math.max(0, Math.min(100, Math.round(charge)));
  if (pct < 15) return { icon: BatteryWarning, text: `${pct}%`, cls: "text-destructive bg-destructive/10", barCls: "bg-destructive", pct };
  if (pct < 30) return { icon: BatteryLow, text: `${pct}%`, cls: "text-warning bg-warning/10", barCls: "bg-warning", pct };
  if (pct >= 80) return { icon: BatteryFull, text: `${pct}%`, cls: "text-success bg-success/10", barCls: "bg-success", pct };
  return { icon: Battery, text: `${pct}%`, cls: "text-success bg-success/10", barCls: "bg-success", pct };
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
    <Card>
      <CardContent className="pt-5 pb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400 flex items-center justify-center">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                LOQED Status
                {info?.modelName && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {info.modelName}</span>
                )}
              </h3>
              <p className="text-[11px] text-muted-foreground/70">
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
          <div className="rounded-lg bg-destructive/10 text-destructive text-xs px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", bolt.cls)}>
                <BoltIcon className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Riegel</p>
            </div>
            <p className="text-lg font-bold text-foreground leading-tight">
              {loqedBoltStateLabel(info?.boltState)}
            </p>
          </div>

          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", bat.cls)}>
                <BatIcon className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Batterie</p>
            </div>
            <p className="text-lg font-bold text-foreground leading-tight tabular-nums">
              {bat.text}
            </p>
            {bat.pct !== null && (
              <div className="h-1.5 rounded-full bg-border dark:bg-accent overflow-hidden">
                <div className={cn("h-full transition-all", bat.barCls)} style={{ width: `${bat.pct}%` }} />
              </div>
            )}
            {info?.batteryType && (
              <p className="text-[10px] text-muted-foreground/70">{info.batteryType}</p>
            )}
          </div>

          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="h-6 w-6 rounded-md bg-slate-500/10 text-muted-foreground flex items-center justify-center">
                <DoorOpen className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Bauart</p>
            </div>
            <p className="text-sm font-semibold text-foreground leading-tight">
              {info?.mortiseLockType
                ? MORTISE_LABELS[info.mortiseLockType] ?? info.mortiseLockType
                : "—"}
            </p>
            {canOpen === false && (
              <p className="text-[10px] text-warning">
                Öffnen wird nicht unterstützt
              </p>
            )}
          </div>
        </div>

        {info?.batteryPercentage != null && info.batteryPercentage >= 0 && info.batteryPercentage < 30 && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs text-destructive">
              <p className="font-semibold">Batterie schwach</p>
              <p className="opacity-90">
                Bei leerer Batterie lässt sich die Tür nicht mehr aus EMP öffnen. Batterien bald wechseln.
              </p>
            </div>
          </div>
        )}

        {info?.lastEvent && (
          <div className="rounded-lg bg-muted/40 border border-border px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 inline-flex items-center gap-1">
              <Activity className="h-3 w-3" /> Letztes Ereignis
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-foreground/80 inline-flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground/70" />
                {info.lastEvent.at ? fmtDateTime(info.lastEvent.at) : "—"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-foreground/80">
                {loqedBoltStateLabel(info.lastEvent.boltState)}
              </span>
              {info.lastEvent.keyName && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-foreground/80 inline-flex items-center gap-0.5">
                    <UserIcon className="h-3 w-3 text-muted-foreground/70" />
                    {info.lastEvent.keyName}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {!info && (
          <p className="text-xs text-muted-foreground/70 italic text-center py-4">
            Noch keine LOQED-Daten. Über &bdquo;Aktualisieren&ldquo; den aktuellen Zustand abrufen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

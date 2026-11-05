"use client";

import { useState } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
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

// `tone` färbt den Symbol-Chip der Kachel.
function boltMeta(state: string | null | undefined): { icon: typeof Lock; tone: ChipTone } {
  switch (state) {
    case "night_lock":
      return { icon: Lock, tone: "success" };
    case "day_lock":
      return { icon: Unlock, tone: "neutral" };
    case "open":
      return { icon: DoorOpen, tone: "warning" };
    default:
      return { icon: Activity, tone: "neutral" };
  }
}

/**
 * LOQED meldet -1, wenn das Schloss offline ist. Das ist keine leere Batterie,
 * sondern eine fehlende Angabe.
 */
function batteryMeta(
  charge: number | null | undefined,
): { icon: typeof Battery; text: string; tone: ChipTone; barCls: string; pct: number | null } {
  if (charge == null || charge < 0) {
    return { icon: Battery, text: "—", tone: "neutral", barCls: "bg-muted-foreground/50", pct: null };
  }
  const pct = Math.max(0, Math.min(100, Math.round(charge)));
  if (pct < 15) return { icon: BatteryWarning, text: `${pct}%`, tone: "danger", barCls: "bg-destructive", pct };
  if (pct < 30) return { icon: BatteryLow, text: `${pct}%`, tone: "warning", barCls: "bg-warning", pct };
  if (pct >= 80) return { icon: BatteryFull, text: `${pct}%`, tone: "success", barCls: "bg-success", pct };
  return { icon: Battery, text: `${pct}%`, tone: "success", barCls: "bg-success", pct };
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
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2">
          <IconChip icon={KeyRound} />
          <div className="min-w-0">
            <CardTitle>
              <h3>
                LOQED Status
                {info?.modelName && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {info.modelName}</span>
                )}
              </h3>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              Aktualisiert: {refreshedAt ? fmtDateTime(refreshedAt) : "—"}
            </p>
          </div>
        </div>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            className="gap-1.5 max-sm:h-11"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Aktualisieren
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Notice tone="danger" compact title={error} />}

        {/* Kacheln in der Karte (glass-tile), 8 px Abstand */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div className="glass-tile p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <IconChip icon={BoltIcon} size="sm" tone={bolt.tone} />
              <p className="text-label">Riegel</p>
            </div>
            {/* „zu (Tagverriegelung)“ ist breiter als eine schmale Kachel: umbrechen statt überlaufen. */}
            <p className="text-lg font-bold text-foreground leading-tight break-words hyphens-auto">
              {loqedBoltStateLabel(info?.boltState)}
            </p>
          </div>

          <div className="glass-tile p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <IconChip icon={BatIcon} size="sm" tone={bat.tone} />
              <p className="text-label">Batterie</p>
            </div>
            <p className="text-lg font-bold text-foreground leading-tight tabular-nums">
              {bat.text}
            </p>
            {bat.pct !== null && (
              <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div className={cn("h-full transition-all", bat.barCls)} style={{ width: `${bat.pct}%` }} />
              </div>
            )}
            {info?.batteryType && (
              <p className="text-[11px] text-muted-foreground">{info.batteryType}</p>
            )}
          </div>

          <div className="glass-tile p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <IconChip icon={DoorOpen} size="sm" />
              <p className="text-label">Bauart</p>
            </div>
            <p className="text-sm font-semibold text-foreground leading-tight">
              {info?.mortiseLockType
                ? MORTISE_LABELS[info.mortiseLockType] ?? info.mortiseLockType
                : "—"}
            </p>
            {canOpen === false && (
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                Öffnen wird nicht unterstützt
              </p>
            )}
          </div>
        </div>

        {info?.batteryPercentage != null && info.batteryPercentage >= 0 && info.batteryPercentage < 30 && (
          // Bleibender Zustand, deshalb role="status" statt Alarm.
          <Notice tone={bat.tone === "danger" ? "danger" : "warning"} compact role="status" icon={AlertTriangle} title="Batterie schwach">
            Bei leerer Batterie lässt sich die Tür nicht mehr aus EMP öffnen. Batterien bald wechseln.
          </Notice>
        )}

        {info?.lastEvent && (
          <div className="glass-tile px-3 py-2">
            <p className="text-label mb-1.5 inline-flex items-center gap-1">
              <Activity className="h-3 w-3" /> Letztes Ereignis
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-foreground/80 inline-flex items-center gap-1 tabular-nums">
                <Clock className="h-3 w-3 text-muted-foreground/70" />
                {info.lastEvent.at ? fmtDateTime(info.lastEvent.at) : "—"}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="text-foreground/80">
                {loqedBoltStateLabel(info.lastEvent.boltState)}
              </span>
              {info.lastEvent.keyName && (
                <>
                  <span className="text-muted-foreground/60">·</span>
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
          <EmptyState
            compact
            icon={KeyRound}
            title="Noch keine LOQED-Daten."
            description="Über „Aktualisieren“ den aktuellen Zustand abrufen."
          />
        )}
      </CardContent>
    </Card>
  );
}

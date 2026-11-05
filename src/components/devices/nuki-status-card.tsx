"use client";

import { useState } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import {
  Battery, BatteryLow, BatteryWarning, BatteryFull,
  Lock, Unlock, KeyRound, RefreshCw, Loader2, AlertTriangle,
  Activity, Wifi, WifiOff, Clock, User as UserIcon, Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/utils";

interface NukiSystemInfo {
  nukiType?: number | null;
  nukiTypeLabel?: string | null;
  state?: {
    state?: number | null;
    stateName?: string | null;
    batteryCritical?: boolean | null;
    batteryCharging?: boolean | null;
    batteryCharge?: number | null;
    keypadBatteryCritical?: boolean | null;
    doorState?: number | null;
    lastAction?: number | null;
    trigger?: number | null;
  } | null;
  stateLabel?: string | null;
  serverState?: number | null;
  batteryCharge?: number | null;
  batteryCritical?: boolean | null;
  batteryCharging?: boolean | null;
  keypadBatteryCritical?: boolean | null;
  virtualDevice?: boolean | null;
  refreshedAt?: string | null;
  syncedAt?: string | null;
  importedAt?: string | null;
  lastEvent?: {
    state?: number | null;
    stateLabel?: string | null;
    trigger?: number | null;
    triggerLabel?: string | null;
    authName?: string | null;
    at?: string | null;
  } | null;
}

interface Props {
  deviceId: number;
  initialInfo: NukiSystemInfo | null;
  firmware: string | null;
  lastUpdate: string | null;
}

/**
 * Zustandsfarbe eines Nuki-Codes, gemeinsam für diese Karte und die Geräteliste:
 * verriegelt = grün, entriegelt oder am Entriegeln = Hinweis, blockiert = Störung.
 */
export function nukiStateTone(state: number | null | undefined): "success" | "warning" | "danger" | "neutral" {
  switch (state) {
    case 1:
    case 4: return "success";
    case 2:
    case 3:
    case 5:
    case 6:
    case 7: return "warning";
    case 254: return "danger";
    default: return "neutral";
  }
}

// Nuki state codes — siehe lib/nuki.ts. `tone` färbt den Symbol-Chip der Kachel.
function stateMeta(state: number | null | undefined): { label: string; icon: typeof Lock; tone: ChipTone } {
  const tone = nukiStateTone(state);
  switch (state) {
    case 1: return { label: "Verschlossen",     icon: Lock,           tone };
    case 2: return { label: "Entriegeln…",      icon: Unlock,         tone };
    case 3: return { label: "Entriegelt",       icon: Unlock,         tone };
    case 4: return { label: "Verriegeln…",      icon: Lock,           tone };
    case 5: return { label: "Entriegelt (Falle)", icon: Unlock,       tone };
    case 6: return { label: "Lock'n'Go",        icon: Unlock,         tone };
    case 7: return { label: "Falle wird geöffnet", icon: Unlock,      tone };
    case 254: return { label: "Motor blockiert", icon: AlertTriangle, tone };
    case 0:
    case 255:
    default: return { label: "Unbekannt", icon: Activity, tone };
  }
}

function batteryMeta(
  charge: number | null,
  critical: boolean,
  charging: boolean,
): { icon: typeof Battery; text: string; tone: ChipTone; barCls: string; pct: number | null } {
  // Wenn kein Wert (z. B. Smart Lock 1/2 ohne Charge-Info): nur critical-Flag.
  if (charge == null) {
    if (critical) return { icon: BatteryLow,  text: "Schwach", tone: "danger", barCls: "bg-destructive", pct: null };
    return { icon: Battery, text: "OK", tone: "neutral", barCls: "bg-muted-foreground/50", pct: null };
  }
  const pct = Math.max(0, Math.min(100, Math.round(charge)));
  if (charging) return { icon: Plug,         text: `${pct}% (lädt)`, tone: "info",    barCls: "bg-info",     pct };
  if (critical || pct < 15) return { icon: BatteryWarning, text: `${pct}%`, tone: "danger",  barCls: "bg-destructive",    pct };
  if (pct < 30)             return { icon: BatteryLow,     text: `${pct}%`, tone: "warning", barCls: "bg-warning",   pct };
  if (pct >= 80)            return { icon: BatteryFull,    text: `${pct}%`, tone: "success", barCls: "bg-success", pct };
  return                          { icon: Battery,         text: `${pct}%`, tone: "success", barCls: "bg-success", pct };
}

function serverStateMeta(state: number | null | undefined) {
  // Nuki Server State: 0 ok, 1 server unreachable, 2 firmware not supported,
  // 3 server unreachable plus, 254 admin-pin, 255 misc error.
  if (state === 0 || state == null) return { online: true,  label: "Online" };
  if (state === 1 || state === 3)   return { online: false, label: "Offline (Server)" };
  return { online: false, label: `Server-Status ${state}` };
}

export function NukiStatusCard({ deviceId, initialInfo, firmware, lastUpdate }: Props) {
  const [info, setInfo] = useState<NukiSystemInfo | null>(initialInfo);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/nuki-refresh`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInfo(data.systemInfo as NukiSystemInfo);
      } else {
        setError(data.error ?? `Fehler ${res.status}`);
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setRefreshing(false);
    }
  }

  // Battery: webhook setzt batteryCharge/batteryCritical auf Top-Level, sync
  // setzt sie auf Top-Level UND innerhalb info.state. Wir bevorzugen den
  // explizit gesetzten Top-Level-Wert, fallen zurueck auf info.state.
  const batteryCharge =
    info?.batteryCharge ??
    info?.state?.batteryCharge ??
    null;
  const batteryCritical = !!(info?.batteryCritical ?? info?.state?.batteryCritical);
  const batteryCharging = !!(info?.batteryCharging ?? info?.state?.batteryCharging);
  const keypadCritical  = !!(info?.keypadBatteryCritical ?? info?.state?.keypadBatteryCritical);
  const stateCode = info?.state?.state ?? null;
  const refreshedAt = info?.refreshedAt ?? info?.syncedAt ?? info?.importedAt ?? lastUpdate;

  const bat = batteryMeta(batteryCharge, batteryCritical, batteryCharging);
  const BatIcon = bat.icon;
  const st = stateMeta(stateCode);
  const StIcon = st.icon;
  const server = serverStateMeta(info?.serverState ?? null);

  return (
    <Card>
      {/* Header */}
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2">
          <IconChip icon={KeyRound} />
          <div className="min-w-0">
            <CardTitle>
              <h3>
                Nuki Status
                {info?.nukiTypeLabel && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {info.nukiTypeLabel}</span>
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
            className="h-8 gap-1.5 max-sm:h-11"
          >
            {refreshing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Aktualisieren
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Notice tone="danger" compact title={error} />}

        {/* Stat-Tiles: Kacheln in der Karte (glass-tile), 8 px Abstand */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {/* Battery */}
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
            {batteryCharging && (
              <p className="text-[11px] text-info inline-flex items-center gap-0.5">
                <Plug className="h-2.5 w-2.5" /> wird geladen
              </p>
            )}
          </div>

          {/* State */}
          <div className="glass-tile p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <IconChip icon={StIcon} size="sm" tone={st.tone} />
              <p className="text-label">Zustand</p>
            </div>
            <p className="text-lg font-bold text-foreground leading-tight">
              {st.label}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums">Code {stateCode ?? "—"}</p>
          </div>

          {/* Server-Verbindung */}
          <div className="glass-tile p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <IconChip
                icon={server.online ? Wifi : WifiOff}
                size="sm"
                tone={server.online ? "success" : "danger"}
              />
              <p className="text-label">Cloud</p>
            </div>
            <p className="text-lg font-bold text-foreground leading-tight">
              {server.label}
            </p>
            {firmware && (
              <p className="text-[11px] text-muted-foreground">FW {firmware}</p>
            )}
          </div>

          {/* Keypad / Extras */}
          <div className="glass-tile p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <IconChip icon={KeyRound} size="sm" tone={keypadCritical ? "danger" : "neutral"} />
              <p className="text-label">Keypad</p>
            </div>
            <p className="text-sm font-semibold text-foreground leading-tight">
              {keypadCritical ? "Batterie schwach" : "OK"}
            </p>
            {info?.virtualDevice && (
              <Badge variant="secondary">Virtuell</Badge>
            )}
          </div>
        </div>

        {/* Warnungen: bleibender Zustand, deshalb role="status" statt Alarm. */}
        {(batteryCritical || keypadCritical) && (
          <Notice tone="danger" compact role="status" icon={AlertTriangle} title="Batterie-Warnung">
            {batteryCritical && "Smart Lock-Batterie schwach. "}
            {keypadCritical && "Keypad-Batterie schwach. "}
            Batterien bald ersetzen oder Lock aufladen.
          </Notice>
        )}

        {/* Letztes Event (vom Webhook) */}
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
                {info.lastEvent.stateLabel ?? "—"}
              </span>
              {info.lastEvent.triggerLabel && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="text-muted-foreground">via {info.lastEvent.triggerLabel}</span>
                </>
              )}
              {info.lastEvent.authName && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <span className="text-foreground/80 inline-flex items-center gap-0.5">
                    <UserIcon className="h-3 w-3 text-muted-foreground/70" />
                    {info.lastEvent.authName}
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
            title="Noch keine Nuki-Daten."
            description="Klicke auf „Aktualisieren“, um den aktuellen Zustand abzurufen."
          />
        )}
      </CardContent>
    </Card>
  );
}

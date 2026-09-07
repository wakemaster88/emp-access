"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// Nuki state codes — siehe lib/nuki.ts.
function stateMeta(state: number | null | undefined) {
  switch (state) {
    case 1: return { label: "Verschlossen",     icon: Lock,           cls: "bg-success/12 text-success" };
    case 2: return { label: "Entriegeln…",      icon: Unlock,         cls: "bg-warning/14 text-warning" };
    case 3: return { label: "Entriegelt",       icon: Unlock,         cls: "bg-warning/14 text-warning" };
    case 4: return { label: "Verriegeln…",      icon: Lock,           cls: "bg-success/12 text-success" };
    case 5: return { label: "Entriegelt (Falle)", icon: Unlock,       cls: "bg-warning/14 text-warning" };
    case 6: return { label: "Lock'n'Go",        icon: Unlock,         cls: "bg-info/12 text-info" };
    case 7: return { label: "Falle wird geöffnet", icon: Unlock,      cls: "bg-warning/14 text-warning" };
    case 254: return { label: "Motor blockiert", icon: AlertTriangle, cls: "bg-destructive/12 text-destructive" };
    case 0:
    case 255:
    default: return { label: "Unbekannt", icon: Activity, cls: "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground" };
  }
}

function batteryMeta(charge: number | null, critical: boolean, charging: boolean) {
  // Wenn kein Wert (z. B. Smart Lock 1/2 ohne Charge-Info): nur critical-Flag.
  if (charge == null) {
    if (critical) return { icon: BatteryLow,  text: "Schwach", cls: "text-destructive bg-destructive/10", barCls: "bg-destructive", pct: null };
    return { icon: Battery, text: "OK", cls: "text-muted-foreground bg-slate-500/10", barCls: "bg-slate-400", pct: null };
  }
  const pct = Math.max(0, Math.min(100, Math.round(charge)));
  if (charging) return { icon: Plug,         text: `${pct}% (lädt)`, cls: "text-info bg-info/10",         barCls: "bg-info",     pct };
  if (critical || pct < 15) return { icon: BatteryWarning, text: `${pct}%`, cls: "text-destructive bg-destructive/10",     barCls: "bg-destructive",    pct };
  if (pct < 30)             return { icon: BatteryLow,     text: `${pct}%`, cls: "text-warning bg-warning/10", barCls: "bg-warning",   pct };
  if (pct >= 80)            return { icon: BatteryFull,    text: `${pct}%`, cls: "text-success bg-success/10", barCls: "bg-success", pct };
  return                          { icon: Battery,         text: `${pct}%`, cls: "text-success bg-success/10", barCls: "bg-success", pct };
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
      <CardContent className="pt-5 pb-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Nuki Status
                {info?.nukiTypeLabel && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {info.nukiTypeLabel}</span>
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
            {refreshing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Aktualisieren
          </Button>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-xs px-3 py-2">
            {error}
          </div>
        )}

        {/* Stat-Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Battery */}
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
            {batteryCharging && (
              <p className="text-[10px] text-info inline-flex items-center gap-0.5">
                <Plug className="h-2.5 w-2.5" /> wird geladen
              </p>
            )}
          </div>

          {/* State */}
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className={cn("h-6 w-6 rounded-md flex items-center justify-center", st.cls)}>
                <StIcon className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Zustand</p>
            </div>
            <p className="text-lg font-bold text-foreground leading-tight">
              {st.label}
            </p>
            <p className="text-[10px] text-muted-foreground/70">Code {stateCode ?? "—"}</p>
          </div>

          {/* Server-Verbindung */}
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className={cn(
                "h-6 w-6 rounded-md flex items-center justify-center",
                server.online
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
              )}>
                {server.online
                  ? <Wifi className="h-3.5 w-3.5" />
                  : <WifiOff className="h-3.5 w-3.5" />}
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Cloud</p>
            </div>
            <p className="text-lg font-bold text-foreground leading-tight">
              {server.label}
            </p>
            {firmware && (
              <p className="text-[10px] text-muted-foreground/70">FW {firmware}</p>
            )}
          </div>

          {/* Keypad / Extras */}
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className={cn(
                "h-6 w-6 rounded-md flex items-center justify-center",
                keypadCritical
                  ? "bg-destructive/10 text-destructive"
                  : "bg-slate-500/10 text-muted-foreground",
              )}>
                <KeyRound className="h-3.5 w-3.5" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Keypad</p>
            </div>
            <p className="text-sm font-semibold text-foreground leading-tight">
              {keypadCritical ? "Batterie schwach" : "OK"}
            </p>
            {info?.virtualDevice && (
              <Badge variant="secondary" className="text-[9px]">Virtuell</Badge>
            )}
          </div>
        </div>

        {/* Warnungen */}
        {(batteryCritical || keypadCritical) && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs text-destructive">
              <p className="font-semibold">Batterie-Warnung</p>
              <p className="opacity-90">
                {batteryCritical && "Smart Lock-Batterie schwach. "}
                {keypadCritical && "Keypad-Batterie schwach. "}
                Batterien bald ersetzen oder Lock aufladen.
              </p>
            </div>
          </div>
        )}

        {/* Letztes Event (vom Webhook) */}
        {info?.lastEvent && (
          <div className="rounded-lg bg-muted/40 border border-border px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 inline-flex items-center gap-1">
              <Activity className="h-3 w-3" /> Letztes Ereignis
            </p>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-foreground/80 inline-flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground/70" />
                {info.lastEvent.at ? fmtDateTime(info.lastEvent.at) : "—"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-foreground/80">
                {info.lastEvent.stateLabel ?? "—"}
              </span>
              {info.lastEvent.triggerLabel && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-muted-foreground">via {info.lastEvent.triggerLabel}</span>
                </>
              )}
              {info.lastEvent.authName && (
                <>
                  <span className="text-slate-300">·</span>
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
          <p className="text-xs text-muted-foreground/70 italic text-center py-4">
            Noch keine Nuki-Daten. Klicke auf &bdquo;Aktualisieren&ldquo;, um den aktuellen Zustand abzurufen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

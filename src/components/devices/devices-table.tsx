"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity,
  Battery,
  BatteryLow,
  BatteryWarning,
  ChevronRight,
  Clock,
  Cpu,
  DoorOpen,
  Droplets,
  GitMerge,
  Globe,
  KeyRound,
  Lightbulb,
  Lock,
  MapPin,
  Plug,
  Power,
  PowerOff,
  ScanLine,
  Sprout,
  Square,
  ToggleRight,
  Unlock,
  Umbrella,
  Wifi,
  WifiOff,
  Zap,
  Blinds,
  CircleDot,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { coverMotionLabel, type CoverMotion } from "@/lib/cover-constants";
import { loqedBoltStateLabel } from "@/lib/loqed-constants";
import type { SensorReading } from "@/lib/shelly-sensor";
import { SensorReadings } from "./sensor-readings";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Area { id: number; name: string }

interface Device {
  id: number;
  name: string;
  type: string;
  category: string | null;
  ipAddress: string | null;
  isActive: boolean;
  task: number;
  accessIn: number | null;
  accessOut: number | null;
  lastUpdate: Date | string | null;
  systemInfo?: unknown;
  _count: { scans: number };
}

// Nuki-Status aus device.systemInfo (Top-Level oder verschachtelt) ableiten.
function nukiStatus(info: unknown): {
  state: number | null;
  charge: number | null;
  critical: boolean;
  charging: boolean;
  keypadCritical: boolean;
} {
  if (!info || typeof info !== "object") {
    return { state: null, charge: null, critical: false, charging: false, keypadCritical: false };
  }
  const i = info as Record<string, unknown>;
  const inner = (i.state && typeof i.state === "object") ? (i.state as Record<string, unknown>) : {};
  const charge = (typeof i.batteryCharge === "number") ? i.batteryCharge
    : (typeof inner.batteryCharge === "number") ? inner.batteryCharge
    : null;
  return {
    state: typeof inner.state === "number" ? inner.state : null,
    charge,
    critical: !!(i.batteryCritical ?? inner.batteryCritical),
    charging: !!(i.batteryCharging ?? inner.batteryCharging),
    keypadCritical: !!(i.keypadBatteryCritical ?? inner.keypadBatteryCritical),
  };
}

/**
 * Riegel und Batterie eines LOQED aus `device.systemInfo`, wie der Abgleich sie
 * hinterlegt. Ein Wert unter null bedeutet bei LOQED "Schloss offline", nicht
 * "leer" – deshalb faellt er hier weg statt als 0 % zu erscheinen.
 */
function loqedStatus(info: unknown): { bolt: string | null; charge: number | null } {
  if (!info || typeof info !== "object") return { bolt: null, charge: null };
  const i = info as Record<string, unknown>;
  const charge = typeof i.batteryPercentage === "number" && i.batteryPercentage >= 0
    ? i.batteryPercentage
    : null;
  return { bolt: typeof i.boltState === "string" ? i.boltState : null, charge };
}

interface ShellyStatus {
  id: number;
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
  /// Nur bei Antrieben (Markise, Rolltor).
  motion?: CoverMotion;
  /// Fahrposition in Prozent (100 = offen) – nur bei kalibrierten Antrieben.
  position?: number | null;
  /// Messwerte des Geräts (Türkontakt, Temperatur, Batterie …).
  readings?: SensorReading[];
}

interface GardenaStatus {
  id: number;
  online: boolean;
  activity: string | null;
  watering: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  modelType: string | null;
  source: "cloud" | "unavailable";
}

function gardenaActivityLabel(activity: string | null): string {
  switch (activity) {
    case "CLOSED": return "Geschlossen";
    case "MANUAL_WATERING": return "Bewässert";
    case "SCHEDULED_WATERING": return "Bewässert (Plan)";
    case "PAUSED": return "Pausiert";
    default: return activity ?? "Unbekannt";
  }
}

interface DevicesTableProps {
  devices: Device[];
  areas: Area[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  DREHKREUZ:   { label: "Drehkreuz",   icon: GitMerge,    color: "bg-primary/10 text-primary " },
  TUER:        { label: "Tür",         icon: DoorOpen,    color: "bg-info/12 text-info" },
  SENSOR:      { label: "Sensor",      icon: Activity,    color: "bg-success/12 text-success" },
  SCHALTER:    { label: "Schalter",    icon: ToggleRight, color: "bg-warning/14 text-warning" },
  BELEUCHTUNG: { label: "Beleuchtung", icon: Lightbulb,   color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  MARKISE:     { label: "Markise",     icon: Umbrella,    color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" },
  ROLLTOR:     { label: "Rolltor",     icon: Blinds,      color: "bg-muted text-muted-foreground" },
  TASTER:      { label: "Taster",      icon: CircleDot,   color: "bg-destructive/12 text-destructive" },
  AUDIO:       { label: "Audio-Zone",  icon: Volume2,     color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
};

const TASK_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Öffne einmal", color: "bg-success/12 text-success" },
  2: { label: "NOT-AUF",      color: "bg-destructive/12 text-destructive" },
  3: { label: "Deaktiviert",  color: "bg-warning/14 text-warning" },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function DevicesTable({ devices, areas }: DevicesTableProps) {
  const [shellyStatus, setShellyStatus] = useState<Map<number, ShellyStatus>>(new Map());
  const [gardenaStatus, setGardenaStatus] = useState<Map<number, GardenaStatus>>(new Map());
  const [statusLoading, setStatusLoading] = useState(true);

  const areaMap = Object.fromEntries(areas.map((a) => [a.id, a.name]));
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Single batch fetch for all Shelly devices
  useEffect(() => {
    const shellyIds = devices.filter((d) => d.type === "SHELLY").map((d) => d.id);
    if (shellyIds.length === 0) { setStatusLoading(false); return; }

    fetch(`/api/devices/shelly-statuses?ids=${shellyIds.join(",")}`)
      .then((r) => r.ok ? r.json() : [])
      .then((list: ShellyStatus[]) => {
        setShellyStatus(new Map(list.map((s) => [s.id, s])));
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, [devices]);

  // Single batch fetch for all GARDENA valves
  useEffect(() => {
    const gardenaIds = devices.filter((d) => d.type === "GARDENA_VALVE").map((d) => d.id);
    if (gardenaIds.length === 0) return;

    fetch(`/api/devices/gardena-statuses?ids=${gardenaIds.join(",")}`)
      .then((r) => r.ok ? r.json() : [])
      .then((list: GardenaStatus[]) => {
        setGardenaStatus(new Map(list.map((s) => [s.id, s])));
      })
      .catch(() => {});
  }, [devices]);

  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent bg-muted/40">
            <TableHead className="min-w-[180px] text-muted-foreground font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Wifi className="h-4 w-4 text-muted-foreground/70" />
                Gerät
              </span>
            </TableHead>
            <TableHead className="hidden sm:table-cell w-[140px] text-muted-foreground font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-muted-foreground/70" />
                Funktion
              </span>
            </TableHead>
            <TableHead className="hidden lg:table-cell w-[130px] text-muted-foreground font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-muted-foreground/70" />
                IP-Adresse
              </span>
            </TableHead>
            <TableHead className="hidden md:table-cell min-w-[140px] text-muted-foreground font-medium">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-muted-foreground/70" />
                Resourcen
              </span>
            </TableHead>
            <TableHead className="w-[200px] text-muted-foreground font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-muted-foreground/70" />
                Status
              </span>
            </TableHead>
            <TableHead className="hidden lg:table-cell w-[120px] text-muted-foreground font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground/70" />
                Letzte Aktivität
              </span>
            </TableHead>
            <TableHead className="hidden sm:table-cell w-[80px] text-right text-muted-foreground font-medium">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ScanLine className="h-4 w-4 text-muted-foreground/70" />
                Scans
              </span>
            </TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.length === 0 && (
            <TableRow className="hover:bg-transparent border-border">
              <TableCell colSpan={8} className="p-0">
                <EmptyState
                  icon={Cpu}
                  title="Keine Geräte konfiguriert"
                  description="Füge ein Gerät hinzu (Raspberry Pi, Shelly oder Nuki), um Zugang zu steuern."
                />
              </TableCell>
            </TableRow>
          )}

        {devices.map((device) => {
          const isShelly = device.type === "SHELLY";
          const isPi     = device.type === "RASPBERRY_PI";
          const isNuki   = device.type === "NUKI_SMARTLOCK";
          const isLoqed  = device.type === "LOQED_SMARTLOCK";
          const isGardena = device.type === "GARDENA_VALVE";
          const isAudio  = device.type === "AUDIO_PLAYER";
          const isSensor = device.category === "SENSOR";
          const cat      = device.category ? CATEGORY_META[device.category] : null;
          const lastUpd  = device.lastUpdate ? new Date(device.lastUpdate) : null;
          const piOnline = !!(lastUpd && lastUpd > fiveMinAgo);
          const shelly   = shellyStatus.get(device.id);
          const gardena  = gardenaStatus.get(device.id);

          // Compute status cell content
          const statusCell = (() => {
            if (isShelly) {
              if (statusLoading && !shelly) {
                return (
                  <span className="flex items-center gap-1.5 text-xs text-slate-300 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-border" /> …
                  </span>
                );
              }
              if (!shelly) {
                return <span className="text-xs text-muted-foreground/70">–</span>;
              }
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {shelly.online ? (
                    <Badge variant="success" className="gap-1 text-xs h-5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" /> Online
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground/70 gap-1 text-xs h-5">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Offline
                    </Badge>
                  )}
                  {shelly.online && shelly.motion && shelly.motion !== "unknown" && (
                    <Badge
                      className={cn(
                        "gap-1 text-xs h-5",
                        shelly.motion === "conflict"
                          ? "bg-destructive/12 text-destructive"
                          // Nur eine laufende Fahrt wird hervorgehoben; Endlagen
                          // und Stillstand bleiben ruhig.
                          : shelly.motion === "opening" || shelly.motion === "closing"
                            ? "bg-warning/14 text-warning"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {coverMotionLabel(shelly.motion, device.category)}
                      {shelly.position != null && ` · ${shelly.position} %`}
                    </Badge>
                  )}
                  {/* Ein Sensor hat keinen Ausgang. Steht er auf demselben
                      Shelly wie ein Schaltkanal, wuerde dessen Zustand hier
                      sonst als der des Sensors erscheinen. */}
                  {shelly.online && !shelly.motion && !isSensor && shelly.output === true && (
                    <Badge variant="warning" className="gap-1 text-xs h-5">
                      <Power className="h-3 w-3" /> Ein
                    </Badge>
                  )}
                  {shelly.online && !shelly.motion && !isSensor && shelly.output === false && (
                    <Badge variant="secondary" className="text-muted-foreground/70 gap-1 text-xs h-5">
                      <PowerOff className="h-3 w-3" /> Aus
                    </Badge>
                  )}
                  {/* Offline sind die letzten Messwerte veraltet – dann sagt
                      "Offline" mehr aus als ein alter Wert. */}
                  {shelly.online && shelly.readings && (
                    <SensorReadings readings={shelly.readings} />
                  )}
                  {shelly.power !== undefined && shelly.power > 0.5 && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground/70">
                      <Zap className="h-3 w-3 text-warning" />{shelly.power.toFixed(0)} W
                    </span>
                  )}
                </div>
              );
            }

            // GARDENA Ventil/Pumpe: Online + Bewässerungs-Aktivität + Batterie
            if (isGardena) {
              if (!gardena) {
                return (
                  <span className="flex items-center gap-1.5 text-xs text-slate-300 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-border" /> …
                  </span>
                );
              }
              const hasBat = gardena.batteryState != null && gardena.batteryState !== "NO_BATTERY";
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {gardena.online ? (
                    <Badge variant="success" className="gap-1 text-xs h-5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" /> Online
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground/70 gap-1 text-xs h-5">
                      <WifiOff className="h-3 w-3" /> Offline
                    </Badge>
                  )}
                  {gardena.watering ? (
                    <Badge variant="info" className="gap-1 text-xs h-5">
                      <Droplets className="h-3 w-3" /> {gardenaActivityLabel(gardena.activity)}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground/70 gap-1 text-xs h-5">
                      <Square className="h-3 w-3" /> {gardenaActivityLabel(gardena.activity)}
                    </Badge>
                  )}
                  {hasBat && gardena.batteryLevel != null && (
                    <span className={cn(
                      "flex items-center gap-0.5 text-xs",
                      gardena.batteryLevel < 20 ? "text-destructive" : "text-muted-foreground/70",
                    )}>
                      {gardena.batteryLevel < 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />}
                      {gardena.batteryLevel}%
                    </span>
                  )}
                </div>
              );
            }

            // Nuki Smart Lock: Battery + Zustand
            if (isNuki) {
              const ns = nukiStatus(device.systemInfo);
              const charge = ns.charge;
              const batCls = ns.critical || (charge != null && charge < 15)
                ? "bg-destructive/12 text-destructive"
                : (charge != null && charge < 30)
                  ? "bg-warning/14 text-warning"
                  : "bg-success/12 text-success";
              const BatIcon = ns.charging ? Plug
                : (ns.critical || (charge != null && charge < 15)) ? BatteryWarning
                : (charge != null && charge < 30) ? BatteryLow
                : Battery;
              const stateCls =
                ns.state === 1 || ns.state === 4 ? "bg-success/12 text-success"
                : ns.state === 3 || ns.state === 5 || ns.state === 6 || ns.state === 7 ? "bg-warning/14 text-warning"
                : ns.state === 254 ? "bg-destructive/12 text-destructive"
                : "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground";
              const stateLabel =
                ns.state === 1 ? "Verschlossen"
                : ns.state === 3 ? "Entriegelt"
                : ns.state === 5 ? "Falle offen"
                : ns.state === 6 ? "Lock'n'Go"
                : ns.state === 254 ? "Blockiert"
                : ns.state == null ? "Unbekannt"
                : `State ${ns.state}`;
              const StIcon = ns.state === 1 || ns.state === 4 ? Lock : Unlock;
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className={cn("gap-1 text-xs h-5", stateCls)}>
                    <StIcon className="h-3 w-3" /> {stateLabel}
                  </Badge>
                  <Badge className={cn("gap-1 text-xs h-5", batCls)}>
                    <BatIcon className="h-3 w-3" />
                    {charge != null ? `${Math.round(charge)}%` : (ns.critical ? "schwach" : "OK")}
                  </Badge>
                  {ns.keypadCritical && (
                    <Badge variant="danger" className="gap-1 text-xs h-5">
                      <KeyRound className="h-3 w-3" /> Keypad
                    </Badge>
                  )}
                </div>
              );
            }

            // LOQED-Schloss: Riegelzustand + Batterie
            if (isLoqed) {
              const ls = loqedStatus(device.systemInfo);
              const boltCls =
                ls.bolt === "night_lock" ? "bg-success/12 text-success"
                : ls.bolt === "open" ? "bg-warning/14 text-warning"
                : "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground";
              const batCls = ls.charge != null && ls.charge < 15
                ? "bg-destructive/12 text-destructive"
                : ls.charge != null && ls.charge < 30
                  ? "bg-warning/14 text-warning"
                  : "bg-success/12 text-success";
              const BatIcon = ls.charge != null && ls.charge < 15 ? BatteryWarning
                : ls.charge != null && ls.charge < 30 ? BatteryLow
                : Battery;
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className={cn("gap-1 text-xs h-5", boltCls)}>
                    {ls.bolt === "night_lock" ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    {loqedBoltStateLabel(ls.bolt)}
                  </Badge>
                  {ls.charge != null && (
                    <Badge className={cn("gap-1 text-xs h-5", batCls)}>
                      <BatIcon className="h-3 w-3" /> {Math.round(ls.charge)}%
                    </Badge>
                  )}
                </div>
              );
            }

            // Pi device
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                {piOnline ? (
                  <Badge variant="success" className="gap-1 text-xs h-5">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" /> Online
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-muted-foreground/70 gap-1 text-xs h-5">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Offline
                  </Badge>
                )}
                {device.task > 0 && TASK_LABEL[device.task] && (
                  <Badge className={cn("gap-1 text-xs h-5", TASK_LABEL[device.task].color)}>
                    {TASK_LABEL[device.task].label}
                  </Badge>
                )}
              </div>
            );
          })();

          // Resourcen: Einlass/Auslass mit Icons
          const bereicheCell = (() => {
            if (!isPi || (!device.accessIn && !device.accessOut)) return <span className="text-muted-foreground/70">–</span>;
            const inName  = device.accessIn  ? (areaMap[device.accessIn]  ?? `#${device.accessIn}`)  : null;
            const outName = device.accessOut ? (areaMap[device.accessOut] ?? `#${device.accessOut}`) : null;
            return (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {inName && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5" title="Einlass">
                    <MapPin className="h-3 w-3 text-success shrink-0" />
                    {inName}
                  </span>
                )}
                {outName && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5" title="Auslass">
                    <MapPin className="h-3 w-3 text-info shrink-0" />
                    {outName}
                  </span>
                )}
              </div>
            );
          })();

          return (
            <TableRow
              key={device.id}
              className="group cursor-pointer border-border hover:bg-primary/10 transition-colors"
            >
              {/* Gerät */}
              <TableCell>
                <Link href={`/devices/${device.id}`} className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                    isShelly
                      ? "bg-warning/10 text-warning"
                      : isNuki
                        ? "bg-destructive/10 text-destructive"
                        : isGardena
                          ? "bg-success/10 text-success"
                          : isAudio
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            : "bg-primary/10 text-primary"
                  )}>
                    {isShelly ? <Wifi className="h-4 w-4" /> : isNuki ? <KeyRound className="h-4 w-4" /> : isGardena ? <Sprout className="h-4 w-4" /> : isAudio ? <Volume2 className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                      {device.name}
                    </p>
                    {!device.isActive && (
                      <span className="text-xs text-muted-foreground/70 italic">Inaktiv</span>
                    )}
                  </div>
                </Link>
              </TableCell>

              {/* Funktion */}
              <TableCell className="hidden sm:table-cell">
                {cat ? (
                  <Badge className={cn("text-xs gap-1 w-fit", cat.color)}>
                    <cat.icon className="h-3 w-3" /> {cat.label}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground/70">{isShelly ? "Shelly" : isNuki ? "Nuki" : isGardena ? "GARDENA" : "Pi"}</span>
                )}
              </TableCell>

              {/* IP */}
              <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                {device.ipAddress || <span className="text-slate-300">–</span>}
              </TableCell>

              {/* Bereiche */}
              <TableCell className="hidden md:table-cell">{bereicheCell}</TableCell>

              {/* Status */}
              <TableCell>{statusCell}</TableCell>

              {/* Letzte Aktivität */}
              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground/70 whitespace-nowrap">
                {lastUpd
                  ? fmtDateTime(lastUpd, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : <span className="text-slate-300">–</span>}
              </TableCell>

              {/* Scans */}
              <TableCell className="hidden sm:table-cell text-right font-medium text-sm">
                {device._count.scans > 0 ? (
                  <Link
                    href={`/scans?device=${device.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline"
                  >
                    {device._count.scans}
                  </Link>
                ) : (
                  <span className="text-muted-foreground/70">0</span>
                )}
              </TableCell>

              {/* Pfeil */}
              <TableCell>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );
}

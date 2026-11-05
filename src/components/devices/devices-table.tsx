"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
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
  Loader2,
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
  Zap,
  Blinds,
  CircleDot,
  Tractor,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { coverMotionLabel, type CoverMotion } from "@/lib/cover-constants";
import { loqedBoltStateLabel } from "@/lib/loqed-constants";
import type { SensorReading } from "@/lib/shelly-sensor";
import { SensorReadings } from "./sensor-readings";
import { nukiStateTone } from "./nuki-status-card";
import { mowerTone, readMowerState } from "@/lib/mower";

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

// Die Funktion ist eine Art, kein Zustand: einheitlich als Glas-Pille, ohne eigene Farbe.
const CATEGORY_META: Record<string, { label: string; icon: React.ElementType }> = {
  DREHKREUZ:   { label: "Drehkreuz",   icon: GitMerge },
  TUER:        { label: "Tür",         icon: DoorOpen },
  SENSOR:      { label: "Sensor",      icon: Activity },
  SCHALTER:    { label: "Schalter",    icon: ToggleRight },
  BELEUCHTUNG: { label: "Beleuchtung", icon: Lightbulb },
  MARKISE:     { label: "Markise",     icon: Umbrella },
  ROLLTOR:     { label: "Rolltor",     icon: Blinds },
  TASTER:      { label: "Taster",      icon: CircleDot },
  AUDIO:       { label: "Audio-Zone",  icon: Volume2 },
};

const TASK_LABEL: Record<number, { label: string; variant: "success" | "danger" | "warning" }> = {
  1: { label: "Öffne einmal", variant: "success" },
  2: { label: "NOT-AUF",      variant: "danger" },
  3: { label: "Deaktiviert",  variant: "warning" },
};

type BadgeTone = "success" | "warning" | "danger" | "neutral";

/** Eine Batterie-Skala für alle Geräte: unter 15 % (oder kritisch gemeldet) Störung, unter 30 % Hinweis. */
function batteryTone(charge: number | null, critical = false): BadgeTone {
  if (critical || (charge != null && charge < 15)) return "danger";
  if (charge != null && charge < 30) return "warning";
  return "success";
}

const BATTERY_ICON: Record<BadgeTone, React.ElementType> = {
  danger: BatteryWarning,
  warning: BatteryLow,
  success: Battery,
  neutral: Battery,
};

/** Laden: Ladekreis und ein Verb statt eines stummen Platzhalters. */
function StatusLoading() {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" /> Lädt …
    </span>
  );
}

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

  // Die Tabelle läuft bis an den Kartenrand (`edge`): erste und letzte Spalte rücken auf den Innenabstand der Karte ein.
  return (
      <Table edge>
        <TableHeader>
          <TableRow>
            {/* Handy: einzige sichtbare Spalte, trägt darum auch den rechten Randabstand. */}
            <TableHead className="max-sm:pr-4 sm:min-w-[180px]">
              <span className="inline-flex items-center gap-1.5">
                <Wifi className="h-4 w-4 text-muted-foreground/70" />
                Gerät
              </span>
            </TableHead>
            <TableHead className="hidden sm:table-cell w-[140px]">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-muted-foreground/70" />
                Funktion
              </span>
            </TableHead>
            <TableHead className="hidden lg:table-cell w-[130px]">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-muted-foreground/70" />
                IP-Adresse
              </span>
            </TableHead>
            <TableHead className="hidden md:table-cell min-w-[140px]">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-muted-foreground/70" />
                Resourcen
              </span>
            </TableHead>
            <TableHead className="max-sm:hidden sm:w-[200px]">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-muted-foreground/70" />
                Status
              </span>
            </TableHead>
            <TableHead className="hidden lg:table-cell w-[120px]">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground/70" />
                Letzte Aktivität
              </span>
            </TableHead>
            <TableHead className="hidden sm:table-cell w-[80px] text-right">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ScanLine className="h-4 w-4 text-muted-foreground/70" />
                Scans
              </span>
            </TableHead>
            <TableHead className="hidden w-10 sm:table-cell" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.length === 0 && (
            <TableEmpty
              colSpan={8}
              compact={false}
              icon={Cpu}
              title="Keine Geräte konfiguriert"
              description="Füge ein Gerät hinzu (Raspberry Pi, Shelly oder Nuki), um Zugang zu steuern."
            />
          )}

        {devices.map((device) => {
          const isShelly = device.type === "SHELLY";
          const isPi     = device.type === "RASPBERRY_PI";
          const isNuki   = device.type === "NUKI_SMARTLOCK";
          const isLoqed  = device.type === "LOQED_SMARTLOCK";
          const isGardena = device.type === "GARDENA_VALVE";
          const isAudio  = device.type === "AUDIO_PLAYER";
          const isMower  = device.type === "MAMMOTION_MOWER";
          const isSensor = device.category === "SENSOR";
          const cat      = device.category ? CATEGORY_META[device.category] : null;
          const lastUpd  = device.lastUpdate ? new Date(device.lastUpdate) : null;
          const piOnline = !!(lastUpd && lastUpd > fiveMinAgo);
          const shelly   = shellyStatus.get(device.id);
          const gardena  = gardenaStatus.get(device.id);
          // Außer Betrieb ist „Offline“ erwartet: ruhig statt Störungsrot.
          const offTone: BadgeTone = device.isActive ? "danger" : "neutral";

          // Compute status cell content
          const statusCell = (() => {
            if (isShelly) {
              if (statusLoading && !shelly) {
                return <StatusLoading />;
              }
              if (!shelly) {
                return <span className="text-xs text-muted-foreground">–</span>;
              }
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {shelly.online ? (
                    <Badge variant="success" className="gap-1 text-xs h-5">
                      <StatusDot tone="success" size="xs" /> Online
                    </Badge>
                  ) : (
                    <Badge variant={offTone} className="gap-1 text-xs h-5">
                      <StatusDot tone={offTone} size="xs" /> Offline
                    </Badge>
                  )}
                  {shelly.online && shelly.motion && shelly.motion !== "unknown" && (
                    <Badge
                      className="gap-1 text-xs h-5"
                      variant={
                        shelly.motion === "conflict"
                          ? "danger"
                          // Nur eine laufende Fahrt wird hervorgehoben; Endlagen
                          // und Stillstand bleiben ruhig.
                          : shelly.motion === "opening" || shelly.motion === "closing"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {coverMotionLabel(shelly.motion, device.category)}
                      {shelly.position != null && ` · ${shelly.position} %`}
                    </Badge>
                  )}
                  {/* Ein Sensor hat keinen Ausgang. Steht er auf demselben
                      Shelly wie ein Schaltkanal, wuerde dessen Zustand hier
                      sonst als der des Sensors erscheinen. */}
                  {/* Zustandsfarbe: Licht an = amber (Badge `light`), sonst eingeschaltet = grün. */}
                  {shelly.online && !shelly.motion && !isSensor && shelly.output === true && (
                    <Badge
                      variant={device.category === "BELEUCHTUNG" ? "light" : "success"}
                      className="gap-1 text-xs h-5"
                    >
                      <Power className="h-3 w-3" /> Ein
                    </Badge>
                  )}
                  {shelly.online && !shelly.motion && !isSensor && shelly.output === false && (
                    <Badge variant="neutral" className="gap-1 text-xs h-5">
                      <PowerOff className="h-3 w-3" /> Aus
                    </Badge>
                  )}
                  {/* Offline sind die letzten Messwerte veraltet – dann sagt
                      "Offline" mehr aus als ein alter Wert. */}
                  {shelly.online && shelly.readings && (
                    <SensorReadings readings={shelly.readings} />
                  )}
                  {shelly.power !== undefined && shelly.power > 0.5 && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
                      <Zap className="h-3 w-3" />{shelly.power.toFixed(0)} W
                    </span>
                  )}
                </div>
              );
            }

            // GARDENA Ventil/Pumpe: Online + Bewässerungs-Aktivität + Batterie
            if (isGardena) {
              if (!gardena) {
                return <StatusLoading />;
              }
              const hasBat = gardena.batteryState != null && gardena.batteryState !== "NO_BATTERY";
              const batTone = batteryTone(gardena.batteryLevel);
              const BatIcon = BATTERY_ICON[batTone];
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {gardena.online ? (
                    <Badge variant="success" className="gap-1 text-xs h-5">
                      <StatusDot tone="success" size="xs" /> Online
                    </Badge>
                  ) : (
                    <Badge variant={offTone} className="gap-1 text-xs h-5">
                      <StatusDot tone={offTone} size="xs" /> Offline
                    </Badge>
                  )}
                  {gardena.watering ? (
                    <Badge variant="info" className="gap-1 text-xs h-5">
                      <Droplets className="h-3 w-3" /> {gardenaActivityLabel(gardena.activity)}
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="gap-1 text-xs h-5">
                      <Square className="h-3 w-3" /> {gardenaActivityLabel(gardena.activity)}
                    </Badge>
                  )}
                  {hasBat && gardena.batteryLevel != null && (
                    <span className={cn(
                      "flex items-center gap-0.5 text-xs tabular-nums",
                      batTone === "danger" ? "text-destructive"
                        : batTone === "warning" ? "text-warning"
                        : "text-muted-foreground",
                    )}>
                      <BatIcon className="h-3 w-3" />
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
              const batTone = batteryTone(charge, ns.critical);
              const BatIcon = ns.charging ? Plug : BATTERY_ICON[batTone];
              const stateTone: BadgeTone = nukiStateTone(ns.state);
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
                  <Badge variant={stateTone} className="gap-1 text-xs h-5">
                    <StIcon className="h-3 w-3" /> {stateLabel}
                  </Badge>
                  <Badge variant={batTone} className="gap-1 text-xs h-5 tabular-nums">
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

            // Maehroboter: Zustand und Akku, wie der Hub sie zuletzt gemeldet hat.
            if (isMower) {
              const ms = readMowerState(device.systemInfo);
              const fresh = !!(lastUpd && lastUpd.getTime() > fiveMinAgo.getTime() - 5 * 60_000);
              if (!ms || !fresh) {
                return (
                  <Badge variant="neutral" className="gap-1 text-xs h-5">
                    <StatusDot tone="neutral" size="xs" /> keine Meldung
                  </Badge>
                );
              }
              const tone = mowerTone(ms);
              // Mäht = grün (Live), Störung und offline = rot, Pause = Hinweis, sonst ruhig.
              const toneVariant: BadgeTone =
                tone === "mowing" ? "success"
                : tone === "error" || tone === "offline" ? "danger"
                : tone === "paused" ? "warning"
                : "neutral";
              const charge = ms.battery;
              const batTone = batteryTone(charge);
              const BatIcon = BATTERY_ICON[batTone];
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={toneVariant} className="gap-1 text-xs h-5">
                    <StatusDot tone={toneVariant} size="xs" /> {ms.online ? ms.statusLabel || ms.status : "Offline"}
                  </Badge>
                  {charge != null && (
                    <Badge variant={batTone} className="gap-1 text-xs h-5 tabular-nums">
                      <BatIcon className="h-3 w-3" /> {Math.round(charge)}%
                    </Badge>
                  )}
                </div>
              );
            }

            // LOQED-Schloss: Riegelzustand + Batterie
            if (isLoqed) {
              const ls = loqedStatus(device.systemInfo);
              const boltTone: BadgeTone =
                ls.bolt === "night_lock" ? "success"
                : ls.bolt === "open" ? "warning"
                : "neutral";
              const batTone = batteryTone(ls.charge);
              const BatIcon = BATTERY_ICON[batTone];
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={boltTone} className="gap-1 text-xs h-5">
                    {ls.bolt === "night_lock" ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    {loqedBoltStateLabel(ls.bolt)}
                  </Badge>
                  {ls.charge != null && (
                    <Badge variant={batTone} className="gap-1 text-xs h-5 tabular-nums">
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
                    <StatusDot tone="success" size="xs" /> Online
                  </Badge>
                ) : (
                  <Badge variant={offTone} className="gap-1 text-xs h-5">
                    <StatusDot tone={offTone} size="xs" /> Offline
                  </Badge>
                )}
                {device.task > 0 && TASK_LABEL[device.task] && (
                  <Badge variant={TASK_LABEL[device.task].variant} className="gap-1 text-xs h-5">
                    {TASK_LABEL[device.task].label}
                  </Badge>
                )}
              </div>
            );
          })();

          // Resourcen: Einlass/Auslass mit Icons
          const bereicheCell = (() => {
            if (!isPi || (!device.accessIn && !device.accessOut)) return <span className="text-muted-foreground">–</span>;
            const inName  = device.accessIn  ? (areaMap[device.accessIn]  ?? `#${device.accessIn}`)  : null;
            const outName = device.accessOut ? (areaMap[device.accessOut] ?? `#${device.accessOut}`) : null;
            return (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {inName && (
                  <Badge variant="secondary" className="font-medium" title="Einlass">
                    <MapPin className="h-3 w-3 text-success shrink-0" />
                    {inName}
                  </Badge>
                )}
                {outName && (
                  <Badge variant="secondary" className="font-medium" title="Auslass">
                    <MapPin className="h-3 w-3 text-info shrink-0" />
                    {outName}
                  </Badge>
                )}
              </div>
            );
          })();

          return (
            <TableRow
              key={device.id}
              className="group"
            >
              {/* Gerät – auf dem Handy die einzige Spalte: der Name bricht um statt zu kürzen
                  („Drehkreuz Seilbah…“ dreimal war nicht zu unterscheiden), der Status steht als
                  Nebenzeile darunter (docs/design-regeln.md, Abschnitt 17). */}
              <TableCell className="max-sm:w-full max-sm:max-w-0 max-sm:pr-4">
                <Link href={`/devices/${device.id}`} className="flex items-center gap-3 min-w-0">
                  {/* Symbol-Chip ruhig: die Geräteart ist kein Zustand, den zeigt die Spalte „Status“ (Abschnitt 3). */}
                  <IconChip
                    icon={isShelly ? Wifi : isNuki ? KeyRound : isGardena ? Sprout : isAudio ? Volume2 : isMower ? Tractor : Cpu}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground group-hover:text-primary transition-colors sm:truncate max-sm:whitespace-normal max-sm:break-words">
                      {device.name}
                    </p>
                    {!device.isActive && (
                      <span className="text-xs text-muted-foreground italic">Inaktiv</span>
                    )}
                    <div className="mt-1 sm:hidden">{statusCell}</div>
                  </div>
                </Link>
              </TableCell>

              {/* Funktion */}
              <TableCell className="hidden sm:table-cell">
                {cat ? (
                  <Badge variant="secondary" className="text-xs gap-1 w-fit">
                    <cat.icon className="h-3 w-3" /> {cat.label}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">{isShelly ? "Shelly" : isNuki ? "Nuki" : isGardena ? "GARDENA" : isMower ? "Mähroboter" : "Pi"}</span>
                )}
              </TableCell>

              {/* IP */}
              <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                {device.ipAddress || <span className="text-muted-foreground">–</span>}
              </TableCell>

              {/* Bereiche */}
              <TableCell className="hidden md:table-cell">{bereicheCell}</TableCell>

              {/* Status – auf dem Handy als Nebenzeile unter dem Namen. */}
              <TableCell className="max-sm:hidden">{statusCell}</TableCell>

              {/* Letzte Aktivität */}
              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {lastUpd
                  ? fmtDateTime(lastUpd, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : <span className="text-muted-foreground">–</span>}
              </TableCell>

              {/* Scans */}
              <TableCell className="hidden sm:table-cell text-right font-medium text-sm tabular-nums">
                {device._count.scans > 0 ? (
                  <Link
                    href={`/scans?device=${device.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline"
                  >
                    {device._count.scans}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>

              {/* Pfeil – führt wie der Name zur Detailseite; für Tastatur und Screenreader reicht der Name-Link. */}
              <TableCell className="hidden sm:table-cell">
                <Link href={`/devices/${device.id}`} tabIndex={-1} aria-hidden="true" className="flex">
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary transition-colors" />
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

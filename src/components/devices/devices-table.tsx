"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity,
  ChevronRight,
  Clock,
  Cpu,
  DoorOpen,
  GitMerge,
  Globe,
  Lightbulb,
  MapPin,
  Power,
  PowerOff,
  ScanLine,
  ToggleRight,
  Wifi,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  _count: { scans: number };
}

interface ShellyStatus {
  id: number;
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
}

interface DevicesTableProps {
  devices: Device[];
  areas: Area[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  DREHKREUZ:   { label: "Drehkreuz",   icon: GitMerge,    color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
  TUER:        { label: "Tür",         icon: DoorOpen,    color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
  SENSOR:      { label: "Sensor",      icon: Activity,    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  SCHALTER:    { label: "Schalter",    icon: ToggleRight, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  BELEUCHTUNG: { label: "Beleuchtung", icon: Lightbulb,   color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

const TASK_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Öffne einmal", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  2: { label: "NOT-AUF",      color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
  3: { label: "Deaktiviert",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function DevicesTable({ devices, areas }: DevicesTableProps) {
  const [shellyStatus, setShellyStatus] = useState<Map<number, ShellyStatus>>(new Map());
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

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
            <TableHead className="w-[260px] text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Wifi className="h-4 w-4 text-slate-400" />
                Gerät
              </span>
            </TableHead>
            <TableHead className="w-[140px] text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-slate-400" />
                Funktion
              </span>
            </TableHead>
            <TableHead className="w-[130px] text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-slate-400" />
                IP-Adresse
              </span>
            </TableHead>
            <TableHead className="min-w-[140px] text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-slate-400" />
                Resourcen
              </span>
            </TableHead>
            <TableHead className="w-[200px] text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-slate-400" />
                Status
              </span>
            </TableHead>
            <TableHead className="w-[120px] text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-slate-400" />
                Letzte Aktivität
              </span>
            </TableHead>
            <TableHead className="w-[80px] text-right text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ScanLine className="h-4 w-4 text-slate-400" />
                Scans
              </span>
            </TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.length === 0 && (
            <TableRow className="hover:bg-transparent border-slate-200 dark:border-slate-700">
              <TableCell colSpan={8} className="text-center py-16">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                  <Cpu className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                  <p className="font-medium text-slate-600 dark:text-slate-400">Keine Geräte konfiguriert</p>
                  <p className="text-sm">Füge ein Gerät hinzu (Raspberry Pi oder Shelly), um Zugang zu steuern.</p>
                </div>
              </TableCell>
            </TableRow>
          )}

        {devices.map((device) => {
          const isShelly = device.type === "SHELLY";
          const isPi     = device.type === "RASPBERRY_PI";
          const cat      = device.category ? CATEGORY_META[device.category] : null;
          const lastUpd  = device.lastUpdate ? new Date(device.lastUpdate) : null;
          const piOnline = !!(lastUpd && lastUpd > fiveMinAgo);
          const shelly   = shellyStatus.get(device.id);

          // Compute status cell content
          const statusCell = (() => {
            if (isShelly) {
              if (statusLoading && !shelly) {
                return (
                  <span className="flex items-center gap-1.5 text-xs text-slate-300 animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-slate-200" /> …
                  </span>
                );
              }
              if (!shelly) {
                return <span className="text-xs text-slate-400">–</span>;
              }
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {shelly.online ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs h-5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-slate-400 gap-1 text-xs h-5">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Offline
                    </Badge>
                  )}
                  {shelly.online && shelly.output === true && (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1 text-xs h-5">
                      <Power className="h-3 w-3" /> Ein
                    </Badge>
                  )}
                  {shelly.online && shelly.output === false && (
                    <Badge variant="secondary" className="text-slate-400 gap-1 text-xs h-5">
                      <PowerOff className="h-3 w-3" /> Aus
                    </Badge>
                  )}
                  {shelly.power !== undefined && shelly.power > 0.5 && (
                    <span className="flex items-center gap-0.5 text-xs text-slate-400">
                      <Zap className="h-3 w-3 text-amber-400" />{shelly.power.toFixed(0)} W
                    </span>
                  )}
                </div>
              );
            }

            // Pi device
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                {piOnline ? (
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs h-5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-slate-400 gap-1 text-xs h-5">
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
            if (!isPi || (!device.accessIn && !device.accessOut)) return <span className="text-slate-400">–</span>;
            const inName  = device.accessIn  ? (areaMap[device.accessIn]  ?? `#${device.accessIn}`)  : null;
            const outName = device.accessOut ? (areaMap[device.accessOut] ?? `#${device.accessOut}`) : null;
            return (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                {inName && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5" title="Einlass">
                    <MapPin className="h-3 w-3 text-emerald-500 shrink-0" />
                    {inName}
                  </span>
                )}
                {outName && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5" title="Auslass">
                    <MapPin className="h-3 w-3 text-sky-500 shrink-0" />
                    {outName}
                  </span>
                )}
              </div>
            );
          })();

          return (
            <TableRow
              key={device.id}
              className="group cursor-pointer border-slate-200 dark:border-slate-700 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-colors"
            >
              {/* Gerät */}
              <TableCell>
                <Link href={`/devices/${device.id}`} className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                    isShelly
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                  )}>
                    {isShelly ? <Wifi className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                      {device.name}
                    </p>
                    {!device.isActive && (
                      <span className="text-xs text-slate-400 italic">Inaktiv</span>
                    )}
                  </div>
                </Link>
              </TableCell>

              {/* Funktion */}
              <TableCell>
                {cat ? (
                  <Badge className={cn("text-xs gap-1 w-fit", cat.color)}>
                    <cat.icon className="h-3 w-3" /> {cat.label}
                  </Badge>
                ) : (
                  <span className="text-xs text-slate-400">{isShelly ? "Shelly" : "Pi"}</span>
                )}
              </TableCell>

              {/* IP */}
              <TableCell className="font-mono text-xs text-slate-500">
                {device.ipAddress || <span className="text-slate-300">–</span>}
              </TableCell>

              {/* Bereiche */}
              <TableCell>{bereicheCell}</TableCell>

              {/* Status */}
              <TableCell>{statusCell}</TableCell>

              {/* Letzte Aktivität */}
              <TableCell className="text-xs text-slate-400 whitespace-nowrap">
                {lastUpd
                  ? fmtDateTime(lastUpd, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : <span className="text-slate-300">–</span>}
              </TableCell>

              {/* Scans */}
              <TableCell className="text-right font-medium text-sm text-slate-700 dark:text-slate-300">
                {device._count.scans}
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

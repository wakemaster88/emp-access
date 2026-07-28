"use client";

import { createElement, useEffect, useMemo, useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  History, CheckCircle2, XCircle, ShieldOff, Smartphone, KeyRound,
  Monitor, DoorOpen, GitMerge, Lightbulb, ToggleRight, Activity,
  Loader2, TrendingUp, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  employeeId: number | null;
  employeeName?: string;
  onClose: () => void;
}

interface HistoryScan {
  id: number;
  code: string;
  note: string | null;
  result: "GRANTED" | "DENIED" | "PROTECTED" | string;
  scanTime: string;
  device: { id: number; name: string; type: string; category: string | null } | null;
  source: "mobile" | "dashboard" | "rfid";
}

interface HistoryStats {
  total: number;
  granted: number;
  denied: number;
  protected: number;
}

interface TopDevice {
  device: { id: number; name: string; type: string; category: string | null } | null;
  count: number;
}

interface ByDay {
  day: string;
  granted: number;
  denied: number;
}

interface HistoryResponse {
  range: { days: number; since: string };
  stats: HistoryStats;
  byDay: ByDay[];
  topDevices: TopDevice[];
  scans: HistoryScan[];
}

const DAYS_OPTIONS = [
  { value: "1",   label: "Heute" },
  { value: "7",   label: "7 Tage" },
  { value: "30",  label: "30 Tage" },
  { value: "90",  label: "90 Tage" },
  { value: "365", label: "12 Monate" },
];

const RESULT_OPTIONS = [
  { value: "all",       label: "Alle" },
  { value: "GRANTED",   label: "Erfolgreich" },
  { value: "DENIED",    label: "Verweigert" },
  { value: "PROTECTED", label: "Gesperrt" },
];

const SOURCE_OPTIONS = [
  { value: "all",       label: "Alle Quellen" },
  { value: "mobile",    label: "Mobile PWA" },
  { value: "rfid",      label: "RFID / Scanner" },
  { value: "dashboard", label: "Dashboard" },
];

function deviceIcon(device: HistoryScan["device"]) {
  if (!device) return DoorOpen;
  if (device.type === "NUKI_SMARTLOCK" || device.type === "LOQED_SMARTLOCK") return KeyRound;
  if (device.category === "DREHKREUZ") return GitMerge;
  if (device.category === "BELEUCHTUNG") return Lightbulb;
  if (device.category === "SCHALTER") return ToggleRight;
  if (device.category === "SENSOR") return Activity;
  return DoorOpen;
}

function sourceMeta(source: HistoryScan["source"]) {
  switch (source) {
    case "mobile":    return { label: "Mobile", icon: Smartphone, cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" };
    case "dashboard": return { label: "Dashboard", icon: Monitor,    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400" };
    case "rfid":
    default:          return { label: "Scanner",  icon: KeyRound,    cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" };
  }
}

function resultMeta(result: string) {
  switch (result) {
    case "GRANTED":   return { label: "OK",        icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-500/10" };
    case "PROTECTED": return { label: "Geschützt", icon: ShieldOff,    cls: "text-amber-600 bg-amber-500/10" };
    default:          return { label: "Verweigert", icon: XCircle,     cls: "text-rose-600 bg-rose-500/10" };
  }
}

function actionLabel(scan: HistoryScan): string {
  if (scan.source === "mobile") {
    // code = "mobile:<ticketId>:<action>"
    const action = scan.code.split(":")[2] ?? "";
    switch (action) {
      case "open":       return "Öffnen";
      case "deactivate": return "Abschließen";
      case "reset":      return "Aus";
      case "emergency":  return "NOT-AUF";
      default:           return action || "Aktion";
    }
  }
  if (scan.source === "dashboard") return "Dashboard-Öffnung";
  return "Scan";
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function fmtDayHeader(dayKey: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date = new Date(dayKey); date.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Gestern";
  if (diff < 7)   return date.toLocaleDateString("de-DE", { weekday: "long" });
  return date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EmployeeHistoryDialog({ employeeId, employeeName, onClose }: Props) {
  const open = employeeId !== null;
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState("30");
  const [result, setResult] = useState("all");
  const [source, setSource] = useState("all");

  const load = useCallback(async () => {
    if (employeeId === null) return;
    setLoading(true);
    try {
      const url = new URL(`/api/employees/${employeeId}/history`, window.location.origin);
      url.searchParams.set("days", days);
      url.searchParams.set("result", result);
      url.searchParams.set("source", source);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [employeeId, days, result, source]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const groupedByDay = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, HistoryScan[]>();
    for (const s of data.scans) {
      const k = dayKey(s.scanTime);
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    return Array.from(map.entries()).map(([day, items]) => ({ day, items }));
  }, [data]);

  const successRate = data && data.stats.total > 0
    ? Math.round((data.stats.granted / data.stats.total) * 100)
    : null;

  const maxBar = Math.max(1, ...(data?.byDay.map((d) => d.granted + d.denied) ?? [0]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-500" />
            Verlauf{employeeName ? ` · ${employeeName}` : ""}
          </DialogTitle>
        </DialogHeader>

        {/* Filter */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={result} onValueChange={setResult}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESULT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <div className="py-10 text-center text-slate-400 text-sm">
            <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
            Lade Verlauf…
          </div>
        )}

        {!loading && data && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-2 mt-3">
              <StatCard label="Gesamt"     value={data.stats.total}   color="slate" />
              <StatCard label="Erfolgreich" value={data.stats.granted} color="emerald" />
              <StatCard label="Verweigert" value={data.stats.denied}  color="rose" />
              <StatCard label="Erfolgsrate" value={successRate !== null ? `${successRate}%` : "—"} color="indigo" />
            </div>

            {/* Mini-Chart letzten 14 Tage */}
            {data.byDay.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 inline-flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Aktivität – 14 Tage
                  </h4>
                  <span className="text-[10px] text-slate-400">
                    {data.byDay.reduce((s, d) => s + d.granted + d.denied, 0)} Scans
                  </span>
                </div>
                <div className="flex items-end gap-0.5 h-14">
                  {data.byDay.map((d) => {
                    const total = d.granted + d.denied;
                    const h = (total / maxBar) * 100;
                    const grantedPct = total > 0 ? (d.granted / total) * 100 : 0;
                    return (
                      <div
                        key={d.day}
                        className="flex-1 min-w-0 flex flex-col justify-end h-full group relative"
                        title={`${d.day}: ${d.granted} OK, ${d.denied} Fehler`}
                      >
                        <div
                          className="w-full rounded-sm bg-slate-200 dark:bg-slate-700 overflow-hidden transition-all"
                          style={{ height: `${Math.max(h, total > 0 ? 6 : 0)}%` }}
                        >
                          <div
                            className="bg-emerald-500"
                            style={{ height: `${grantedPct}%`, width: "100%" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top-Devices */}
            {data.topDevices.length > 0 && (
              <div className="mt-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Häufigste Geräte</h4>
                <div className="flex flex-wrap gap-1.5">
                  {data.topDevices.map((td, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="text-[11px] gap-1 py-0.5 px-2"
                    >
                      {td.device?.name ?? "Unbekannt"}
                      <span className="text-slate-500 font-mono ml-0.5">×{td.count}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="mt-4 space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Verlauf · {data.scans.length} Eintr&auml;ge
              </h4>

              {data.scans.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-sm text-slate-400">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                  Keine Eintr&auml;ge in diesem Zeitraum.
                </div>
              )}

              {groupedByDay.map((group) => (
                <div key={group.day}>
                  <div className="flex items-center gap-2 px-1 mb-1.5">
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      {fmtDayHeader(group.day)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(group.day).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400">{group.items.length}</span>
                  </div>
                  <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                    {group.items.map((scan) => (
                      <HistoryRow key={scan.id} scan={scan} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end mt-4 sticky bottom-0 bg-white dark:bg-slate-950 pt-2 pb-1 -mx-6 px-6 border-t border-slate-200 dark:border-slate-700">
              <Button variant="ghost" size="sm" onClick={onClose}>Schliessen</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function HistoryRow({ scan }: { scan: HistoryScan }) {
  const iconComp = deviceIcon(scan.device);
  const src = sourceMeta(scan.source);
  const res = resultMeta(scan.result);

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      {/* Time */}
      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0 w-9 text-right tabular-nums">
        {fmtTime(scan.scanTime)}
      </span>

      {/* Device icon */}
      <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", src.cls)}>
        {createElement(iconComp, { className: "h-3.5 w-3.5" })}
      </div>

      {/* Device + Action */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight">
          {scan.device?.name ?? <span className="italic text-slate-400">(ohne Gerät)</span>}
        </p>
        <p className="text-[10px] text-slate-500 truncate flex items-center gap-1">
          {createElement(src.icon, { className: "h-2.5 w-2.5 shrink-0" })}
          <span>{src.label}</span>
          <span className="text-slate-300">·</span>
          <span className="truncate">{actionLabel(scan)}</span>
          {scan.note && scan.result !== "GRANTED" && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-rose-500 truncate">{scan.note}</span>
            </>
          )}
        </p>
      </div>

      {/* Result */}
      <div className={cn("h-6 px-1.5 rounded-md inline-flex items-center gap-1 text-[10px] font-bold shrink-0", res.cls)}>
        {createElement(res.icon, { className: "h-3 w-3" })}
        <span>{res.label}</span>
      </div>
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, color,
}: {
  label: string;
  value: string | number;
  color: "slate" | "emerald" | "rose" | "indigo";
}) {
  const cls = {
    slate:   "bg-slate-500/10   text-slate-700   dark:text-slate-300",
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    rose:    "bg-rose-500/10    text-rose-700    dark:text-rose-400",
    indigo:  "bg-indigo-500/10  text-indigo-700  dark:text-indigo-400",
  }[color];

  return (
    <div className={cn("rounded-lg px-3 py-2", cls)}>
      <p className="text-[9px] font-bold uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-lg font-bold tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

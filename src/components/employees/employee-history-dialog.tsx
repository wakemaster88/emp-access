"use client";

import { createElement, useEffect, useMemo, useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { StatCard } from "@/components/ui/stat-card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  History, CheckCircle2, XCircle, ShieldOff, Smartphone, KeyRound,
  Monitor, DoorOpen, GitMerge, Lightbulb, ToggleRight, Activity,
  Loader2, TrendingUp, AlertCircle,
} from "lucide-react";

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

// Quelle nur als Symbol und Text; keine eigene Farbe je Quelle (docs/design-regeln.md, Abschnitt 3).
function sourceMeta(source: HistoryScan["source"]) {
  switch (source) {
    case "mobile":    return { label: "Mobile", icon: Smartphone };
    case "dashboard": return { label: "Dashboard", icon: Monitor };
    case "rfid":
    default:          return { label: "Scanner",  icon: KeyRound };
  }
}

// Ergebnis als Pille in der Zustandsfarbe.
function resultMeta(result: string) {
  switch (result) {
    case "GRANTED":   return { label: "OK",        icon: CheckCircle2, variant: "success" as const };
    case "PROTECTED": return { label: "Geschützt", icon: ShieldOff,    variant: "warning" as const };
    default:          return { label: "Verweigert", icon: XCircle,     variant: "danger" as const };
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          {/* Auf dem Handy mittig wie der Kopf des Blatts (DialogHeader), ab sm linksbündig. */}
          <DialogTitle className="flex items-center justify-center gap-2 sm:justify-start">
            <History className="h-5 w-5 text-primary" />
            Verlauf{employeeName ? ` · ${employeeName}` : ""}
          </DialogTitle>
        </DialogHeader>

        {/* Filter: auf dem Handy untereinander, sonst drei Spalten */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={result} onValueChange={setResult}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESULT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lade Verlauf…
          </div>
        )}

        {!loading && data && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="Gesamt" value={data.stats.total}   tone="neutral" size="sm" />
              <StatCard label="Erfolgreich" value={data.stats.granted} tone="success" size="sm" />
              <StatCard label="Verweigert" value={data.stats.denied}  tone="danger" size="sm" />
              <StatCard label="Erfolgsrate" value={successRate !== null ? `${successRate}%` : "—"} tone="primary" size="sm" />
            </div>

            {/* Mini-Chart letzten 14 Tage */}
            {data.byDay.length > 0 && (
              <div className="glass-tile p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h4 className="text-label inline-flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Aktivität – 14 Tage
                  </h4>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {data.byDay.reduce((s, d) => s + d.granted + d.denied, 0)} Scans
                  </span>
                </div>
                {/* Gestapelte Balken: Erfolgreich unten in Grün, Verweigert darüber in Rot – beide Anteile
                    sichtbar, auch auf der Glas-Kachel (docs/design-regeln.md, Abschnitte 3 und 12). */}
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
                          className="flex w-full flex-col justify-end rounded-sm overflow-hidden transition-all"
                          style={{ height: `${Math.max(h, total > 0 ? 6 : 0)}%` }}
                        >
                          <div className="bg-destructive/70" style={{ height: `${100 - grantedPct}%` }} />
                          <div className="bg-success" style={{ height: `${grantedPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-[3px] bg-success" aria-hidden />
                    Erfolgreich
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-[3px] bg-destructive/70" aria-hidden />
                    Verweigert
                  </span>
                </div>
              </div>
            )}

            {/* Top-Devices */}
            {data.topDevices.length > 0 && (
              <div>
                <h4 className="text-label mb-1.5">Häufigste Geräte</h4>
                <div className="flex flex-wrap gap-1.5">
                  {data.topDevices.map((td, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                    >
                      {td.device?.name ?? "Unbekannt"}
                      <span className="text-muted-foreground font-mono ml-0.5">×{td.count}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-3">
              <h4 className="text-label tabular-nums">
                Verlauf · {data.scans.length} Eintr&auml;ge
              </h4>

              {data.scans.length === 0 && (
                <EmptyState
                  compact
                  icon={AlertCircle}
                  title="Keine Einträge in diesem Zeitraum."
                  className="glass-tile"
                />
              )}

              {groupedByDay.map((group) => (
                <div key={group.day}>
                  <div className="flex items-center gap-2 px-1 mb-1.5">
                    <span className="text-[11px] font-bold text-foreground/80">
                      {fmtDayHeader(group.day)}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {new Date(group.day).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </span>
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{group.items.length}</span>
                  </div>
                  {/* Zeilen einer Gruppe in einer Glas-Kachel, Haarlinien in border-border (Abschnitt 17). */}
                  <div className="glass-tile divide-y divide-border overflow-hidden">
                    {group.items.map((scan) => (
                      <HistoryRow key={scan.id} scan={scan} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Klebende Fußleiste: Rand passend zum Dialog-Innenabstand (p-5, ab sm p-6), sonst läuft sie auf dem Handy über.
                Sie klebt am Inhaltsrand, nicht an der Unterkante: die Fläche darunter (::after, so hoch wie der untere
                Innenabstand) deckt den Streifen ab, durch den sonst beim Scrollen Zeilen unter der Leiste sichtbar wären. */}
            <div className="flex justify-end sticky bottom-0 bg-popover pt-2 pb-1 -mx-5 px-5 sm:-mx-6 sm:px-6 border-t border-border after:absolute after:inset-x-0 after:top-full after:h-[calc(1.25rem+env(safe-area-inset-bottom))] after:bg-popover after:content-[''] sm:after:h-6">
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
      <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-9 text-right tabular-nums">
        {fmtTime(scan.scanTime)}
      </span>

      {/* Device icon – neutral; die Zustandsfarbe trägt das Ergebnis rechts */}
      <IconChip icon={iconComp} size="sm" />

      {/* Device + Action */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
          {scan.device?.name ?? <span className="italic text-muted-foreground">(ohne Gerät)</span>}
        </p>
        <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
          {createElement(src.icon, { className: "h-2.5 w-2.5 shrink-0" })}
          <span>{src.label}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="truncate">{actionLabel(scan)}</span>
          {scan.note && scan.result !== "GRANTED" && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-destructive truncate">{scan.note}</span>
            </>
          )}
        </p>
      </div>

      {/* Result */}
      <Badge variant={res.variant} className="shrink-0">
        {createElement(res.icon, { className: "h-3 w-3" })}
        <span>{res.label}</span>
      </Badge>
    </div>
  );
}


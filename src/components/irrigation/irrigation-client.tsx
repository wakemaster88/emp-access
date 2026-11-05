"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Droplets, Droplet, CloudRain, Sun, Thermometer, Battery, BatteryLow,
  Wifi, WifiOff, Play, Square, Sparkles, Plus, Pencil, Trash2, Clock,
  CalendarDays, Gauge, Loader2, RefreshCw, CircleAlert, Sprout, CheckCircle2,
  Check, X, Activity, Timer, Waves, ChevronUp, ChevronDown, BarChart3, History,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Weather } from "@/lib/weather";
import type { IrrigationRecommendation, IrrigationLevel } from "@/lib/irrigation";

// ── Typen ─────────────────────────────────────────────────────────────────────

interface Zone {
  id: number;
  name: string;
  serviceId: string | null;
  isActive: boolean;
  pumpDeviceId: number | null;
  /// Durchflussrate der Zone (L/h, wie an der Pumpe angezeigt) – Basis fuer
  /// Statistik + Wasserbilanz.
  flowLph: number | null;
  /// Bewaesserte Flaeche (m²) – Basis fuer die exakte Wasserbilanz-Dauer.
  areaSqm: number | null;
}

interface Schedule {
  id: number;
  deviceId: number;
  deviceName: string;
  daysOfWeek: number;
  startTime: string;
  durationMinutes: number;
  isActive: boolean;
  skipOnRain: boolean;
  smartRain: boolean;
  sensorServiceId: string | null;
  moistureThresholdPct: number | null;
  /// Geordnete Ventil-IDs (deviceId = Pumpe) oder null (Einzel-Ventil).
  valveSequence: number[] | null;
  lastRunAt: string | null;
}

interface SoilSensor {
  serviceId: string;
  name: string;
  soilHumidity: number | null;
  soilHumidityAt: string | null;
  soilTemperature: number | null;
  batteryLevel: number | null;
  online: boolean;
  connectionName: string | null;
}

interface ZoneStatus {
  id: number;
  online: boolean;
  activity: string | null;
  watering: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  modelType: string | null;
  source: "cloud" | "unavailable";
}

interface Props {
  connected: boolean;
  zones: Zone[];
  schedules: Schedule[];
  weather: Weather | null;
  recommendation: IrrigationRecommendation;
}

interface SmartRun {
  total: number;
  index: number;      // 0-basiert
  zoneName: string;
  minutes: number;
  remainingSec: number;
}

interface IrrigationRunEntry {
  id: number;
  deviceId: number;
  deviceName: string;
  startedAt: string;
  durationMinutes: number;
  source: string;
  sourceLabel: string;
  litersEstimate: number | null;
  scheduleId: number | null;
}

interface IrrigationDayStats {
  date: string;
  label: string;
  totalMinutes: number;
  totalLiters: number;
  runCount: number;
  valves: Array<{
    deviceId: number;
    deviceName: string;
    totalMinutes: number;
    totalLiters: number;
    runCount: number;
    runs: IrrigationRunEntry[];
  }>;
}

interface IrrigationStatsResponse {
  days: IrrigationDayStats[];
  summary: { totalMinutes: number; totalLiters: number; runCount: number };
  daysRequested: number;
}

// ── Konstanten / Helfer ────────────────────────────────────────────────────────

const ASSUMED_FLOW_L_PER_HOUR = 720;
const DURATION_PRESETS = [5, 10, 15, 20, 30, 45, 60] as const;
// Dauer-Chips (Pumpe und Ventil): Auswahl in Akzentfarbe, sonst ruhige Pille.
// Im Dunkeln Schrift etwas heller als muted: auf der Pille über der Glaskarte lag
// muted bei 3,5–4,4 : 1 (docs/design-regeln.md, Abschnitt 10: 4,5 : 1).
const DURATION_CHIP =
  "press h-8 rounded-full px-2.5 text-xs font-medium tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 max-sm:h-11 max-sm:min-w-11";
const DURATION_CHIP_ON = "bg-primary text-primary-foreground";
const DURATION_CHIP_OFF =
  "bg-foreground/[0.06] text-muted-foreground hover:text-foreground dark:bg-white/[0.08] dark:text-foreground/80 dark:hover:text-foreground";
const DAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DAY_LABELS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

function bitCount(mask: number): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if ((mask >> i) & 1) n++;
  return n;
}

function recommendedMinutes(base: number, rec: IrrigationRecommendation): number {
  if (!rec.shouldWater) return 0;
  return Math.min(90, Math.max(5, Math.round(base * rec.factor)));
}

function fmtDays(mask: number): string {
  if (mask === 127) return "Täglich";
  if (mask === 0b0011111) return "Werktags";
  if (mask === 0b1100000) return "Wochenende";
  const days: string[] = [];
  for (let i = 0; i < 7; i++) if ((mask >> i) & 1) days.push(DAY_LABELS[i]);
  return days.length ? days.join(", ") : "Nie";
}

function fmtCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtLiters(l: number): string {
  return l >= 1000 ? `${(l / 1000).toFixed(2)} m³` : `${Math.round(l)} L`;
}

function fmtRunTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Kurzer Hinweis, wann der Sensor zuletzt gemessen hat. */
function fmtSensorAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `vor ${h} Std`;
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function sensorOptionLabel(s: SoilSensor): string {
  const parts = [s.name];
  if (s.soilHumidity != null) parts.push(`Boden ${Math.round(s.soilHumidity)}%`);
  if (s.batteryLevel != null) parts.push(`Akku ${Math.round(s.batteryLevel)}%`);
  if (s.soilTemperature != null) parts.push(`${Math.round(s.soilTemperature)}°C`);
  return parts.join(" · ");
}

/** Heuristik: Ist die Zone/das Geraet eine Pumpe (Name oder Modell enthaelt „pump")? */
function isPumpZone(name: string, model: string | null | undefined): boolean {
  return `${name} ${model ?? ""}`.toLowerCase().includes("pump");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nächste geplante Bewässerung (Browser-Zeit ≈ Berlin). */
function computeNextRun(schedules: Schedule[]): { label: string; when: Date } | null {
  const now = new Date();
  let best: { label: string; when: Date } | null = null;
  for (const s of schedules) {
    if (!s.isActive) continue;
    const [h, m] = s.startTime.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      d.setHours(h, m, 0, 0);
      const bitIdx = (d.getDay() + 6) % 7; // JS So=0 → bit0=Mo
      if (((s.daysOfWeek >> bitIdx) & 1) !== 1) continue;
      if (d.getTime() <= now.getTime()) continue;
      if (!best || d.getTime() < best.when.getTime()) {
        best = { label: s.deviceName, when: d };
      }
      break;
    }
  }
  return best;
}

// Tag und Uhrzeit getrennt: die Kennzahl zeigt die Uhrzeit, der Tag steht im
// Nebentext – so passt die Kachel auch im Zweier-Raster auf dem Handy.
function fmtNext(when: Date): { day: string; time: string } {
  const now = new Date();
  const sameDay = when.toDateString() === now.toDateString();
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  const isTmr = when.toDateString() === tmr.toDateString();
  const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return { day: "Heute", time };
  if (isTmr) return { day: "Morgen", time };
  return { day: DAY_LABELS[(when.getDay() + 6) % 7], time };
}

// Stufe der Empfehlung als Badge-Variante: Aussetzen informiert, Reduziert ist ruhig,
// Normal ist in Ordnung, Mehr ist ein Hinweis (docs/design-regeln.md, Abschnitt 3).
const LEVEL_STYLES: Record<IrrigationLevel, { variant: "info" | "neutral" | "success" | "warning"; label: string; icon: LucideIcon }> = {
  skip: { variant: "info", label: "Aussetzen", icon: CloudRain },
  reduced: { variant: "neutral", label: "Reduziert", icon: Droplet },
  normal: { variant: "success", label: "Normal", icon: Droplets },
  increased: { variant: "warning", label: "Mehr", icon: Sun },
};

// ── Hauptkomponente ────────────────────────────────────────────────────────────

export function IrrigationClient({
  connected, zones, schedules: initialSchedules, weather, recommendation,
}: Props) {
  const [statuses, setStatuses] = useState<Record<number, ZoneStatus>>({});
  const [statusLoading, setStatusLoading] = useState(false);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [busyZone, setBusyZone] = useState<Record<number, boolean>>({});
  const [busySchedule, setBusySchedule] = useState<Record<number, boolean>>({});
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [zoneList, setZoneList] = useState<Zone[]>(zones);
  const [sensors, setSensors] = useState<SoilSensor[]>([]);
  const [banner, setBanner] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // Laufhistorie / Statistik
  const [statsDays, setStatsDays] = useState(14);
  const [stats, setStats] = useState<IrrigationStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Smart-Run (sequenzielle Komplett-Bewässerung)
  const [baseMinutes, setBaseMinutes] = useState(15);
  const [run, setRun] = useState<SmartRun | null>(null);
  const runToken = useRef<{ cancel: boolean } | null>(null);

  // Zeitplan-Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);

  // Rückfrage vor dem Löschen als AlertDialog (docs/design-regeln.md, Abschnitt 18);
  // der Zeitplan bleibt gesetzt, solange der Dialog ausblendet.
  const [scheduleToDelete, setScheduleToDelete] = useState<Schedule | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Rückfrage „Trotzdem starten?“ als AlertDialog statt Browser-Dialog (Abschnitte 16
  // und 18). Die Antwort kommt als Promise zurück, damit runScheduleNow wie bisher
  // darauf wartet; Abbrechen, Escape und Schließen zählen als „nein“.
  const [forceAsk, setForceAsk] = useState<{ name: string; reason: string; answer: (ok: boolean) => void } | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const askForceRun = useCallback(
    (name: string, reason: string) =>
      new Promise<boolean>((resolve) => {
        setForceAsk({ name, reason, answer: resolve });
        setForceOpen(true);
      }),
    [],
  );

  const controllableIds = useMemo(
    () => zoneList.filter((z) => z.serviceId && z.isActive).map((z) => z.id),
    [zoneList],
  );

  // Eine Zone gilt als Pumpe, wenn sie von einem Ventil als Pumpe zugeordnet ist
  // ODER Name/Modell „pump" enthaelt. (Frueh definiert, da mehrere Callbacks
  // Pumpen aus der Zonen-Sequenz ausschliessen.)
  const pumpIdSet = useMemo(() => {
    const s = new Set<number>();
    for (const z of zoneList) {
      if (z.pumpDeviceId) s.add(z.pumpDeviceId);
      if (isPumpZone(z.name, statuses[z.id]?.modelType)) s.add(z.id);
    }
    return s;
  }, [zoneList, statuses]);

  const flash = useCallback((type: "ok" | "err", msg: string) => {
    setBanner({ type, msg });
    setTimeout(() => setBanner(null), 4000);
  }, []);

  // ── Status laden ─────────────────────────────────────────────────────────────
  // fresh=true umgeht den serverseitigen Cache (manueller Refresh, nach
  // Aktionen). Das Hintergrund-Polling nutzt den Cache und laeuft nur alle
  // 5 Min – die GARDENA-API hat ein hartes Wochen-Kontingent.
  const fetchStatuses = useCallback(async (fresh = false) => {
    if (controllableIds.length === 0) return;
    setStatusLoading(true);
    try {
      const res = await fetch(
        `/api/devices/gardena-statuses?ids=${controllableIds.join(",")}${fresh ? "&fresh=1" : ""}`,
      );
      if (res.ok) {
        const data = (await res.json()) as ZoneStatus[];
        setStatuses(Object.fromEntries(data.map((d) => [d.id, d])));
      }
    } catch {
      /* still stale ok */
    } finally {
      setStatusLoading(false);
    }
  }, [controllableIds]);

  useEffect(() => {
    fetchStatuses();
    const t = setInterval(() => fetchStatuses(), 300_000);
    return () => clearInterval(t);
  }, [fetchStatuses]);

  // Bodenfeuchte-Sensoren laden (alle 5 Min – Werte aendern sich langsam).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/irrigation/sensors");
        if (res.ok && !cancelled) setSensors((await res.json()) as SoilSensor[]);
      } catch { /* Sensoren optional */ }
    };
    load();
    const t = setInterval(load, 300_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/irrigation/runs?days=${statsDays}`);
      if (res.ok) setStats((await res.json()) as IrrigationStatsResponse);
    } catch { /* optional */ } finally {
      setStatsLoading(false);
    }
  }, [statsDays]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Smart-Run bei Unmount abbrechen.
  useEffect(() => () => { if (runToken.current) runToken.current.cancel = true; }, []);

  // ── Zonen-Steuerung ──────────────────────────────────────────────────────────
  const sendAction = useCallback(async (id: number, action: "open" | "deactivate", minutes?: number) => {
    const res = await fetch(`/api/devices/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(minutes ? { minutes } : {}) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Aktion fehlgeschlagen");
    }
  }, []);

  const startZone = useCallback(async (zone: Zone) => {
    const minutes = durations[zone.id] ?? 15;
    setBusyZone((b) => ({ ...b, [zone.id]: true }));
    try {
      await sendAction(zone.id, "open", minutes);
      setStatuses((s) => ({ ...s, [zone.id]: { ...(s[zone.id] ?? emptyStatus(zone.id)), watering: true, activity: "MANUAL_WATERING" } }));
      flash("ok", `${zone.name}: Bewässerung für ${minutes} Min gestartet.`);
      setTimeout(() => fetchStatuses(true), 3000);
      setTimeout(fetchStats, 3000);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyZone((b) => ({ ...b, [zone.id]: false }));
    }
  }, [durations, sendAction, flash, fetchStatuses, fetchStats]);

  const stopZone = useCallback(async (zone: Zone) => {
    setBusyZone((b) => ({ ...b, [zone.id]: true }));
    try {
      await sendAction(zone.id, "deactivate");
      setStatuses((s) => ({ ...s, [zone.id]: { ...(s[zone.id] ?? emptyStatus(zone.id)), watering: false, activity: "CLOSED" } }));
      flash("ok", `${zone.name}: gestoppt.`);
      setTimeout(() => fetchStatuses(true), 3000);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyZone((b) => ({ ...b, [zone.id]: false }));
    }
  }, [sendAction, flash, fetchStatuses]);

  // ── Smart-Run: Zonen nacheinander ───────────────────────────────────────────
  const startSmartRun = useCallback(async () => {
    // Pumpen ueberspringen – sie schalten automatisch mit ihren Ventilen.
    const queue = zoneList.filter((z) => z.serviceId && z.isActive && !pumpIdSet.has(z.id) && (statuses[z.id]?.online ?? true));
    if (queue.length === 0) { flash("err", "Keine steuerbaren Zonen online."); return; }
    const perZone = Math.max(1, recommendedMinutes(baseMinutes, recommendation) || baseMinutes);

    const token = { cancel: false };
    runToken.current = token;
    setRun({ total: queue.length, index: 0, zoneName: queue[0].name, minutes: perZone, remainingSec: perZone * 60 });

    for (let i = 0; i < queue.length; i++) {
      if (token.cancel) break;
      const zone = queue[i];
      setRun({ total: queue.length, index: i, zoneName: zone.name, minutes: perZone, remainingSec: perZone * 60 });
      try {
        await sendAction(zone.id, "open", perZone);
        setStatuses((s) => ({ ...s, [zone.id]: { ...(s[zone.id] ?? emptyStatus(zone.id)), watering: true, activity: "MANUAL_WATERING" } }));
      } catch {
        flash("err", `${zone.name} konnte nicht gestartet werden – übersprungen.`);
        continue;
      }
      const endAt = Date.now() + perZone * 60_000;
      while (Date.now() < endAt) {
        if (token.cancel) break;
        setRun((cur) => (cur ? { ...cur, remainingSec: Math.max(0, Math.round((endAt - Date.now()) / 1000)) } : cur));
        await sleep(1000);
      }
      // Zone sauber schließen, bevor die nächste startet (schont Pumpe/Druck).
      try {
        await sendAction(zone.id, "deactivate");
        setStatuses((s) => ({ ...s, [zone.id]: { ...(s[zone.id] ?? emptyStatus(zone.id)), watering: false, activity: "CLOSED" } }));
      } catch { /* ignore */ }
    }

    const cancelled = token.cancel;
    runToken.current = null;
    setRun(null);
    fetchStatuses(true);
    fetchStats();
    flash(cancelled ? "err" : "ok", cancelled ? "Smart-Bewässerung gestoppt." : "Smart-Bewässerung abgeschlossen.");
  }, [zoneList, statuses, baseMinutes, recommendation, sendAction, flash, fetchStatuses, fetchStats, pumpIdSet]);

  const stopSmartRun = useCallback(async () => {
    if (runToken.current) runToken.current.cancel = true;
    // Aktuelle Zone sofort schließen.
    const cur = run;
    if (cur) {
      const zone = zoneList.filter((z) => z.serviceId && z.isActive && !pumpIdSet.has(z.id))[cur.index];
      if (zone) { try { await sendAction(zone.id, "deactivate"); } catch { /* ignore */ } }
    }
  }, [run, zoneList, sendAction, pumpIdSet]);

  // Zone umbenennen (Device-Name).
  const renameZone = useCallback(async (id: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setZoneList((zs) => zs.map((z) => (z.id === id ? { ...z, name: trimmed } : z)));
    setSchedules((ss) => ss.map((s) => (s.deviceId === id ? { ...s, deviceName: trimmed } : s)));
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error();
      flash("ok", "Zone umbenannt.");
    } catch {
      flash("err", "Umbenennen fehlgeschlagen.");
    }
  }, [flash]);

  // Zonen-Stammdaten (Durchsatz L/h, Flaeche m²) fuer die Wasserbilanz.
  const updateZoneMeta = useCallback(async (id: number, flowLph: number | null, areaSqm: number | null) => {
    const prev = zoneList;
    setZoneList((zs) => zs.map((z) => (z.id === id ? { ...z, flowLph, areaSqm } : z)));
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowLph: flowLph ?? 0, areaSqm: areaSqm ?? 0 }),
      });
      if (!res.ok) throw new Error();
      flash("ok", "Zonen-Daten gespeichert.");
    } catch {
      setZoneList(prev);
      flash("err", "Speichern der Zonen-Daten fehlgeschlagen.");
    }
  }, [zoneList, flash]);

  // Pumpe zuordnen/entfernen (Ventil → Pumpe).
  const assignPump = useCallback(async (valveId: number, pumpId: number | null) => {
    const prev = zoneList;
    setZoneList((zs) => zs.map((z) => (z.id === valveId ? { ...z, pumpDeviceId: pumpId } : z)));
    try {
      const res = await fetch(`/api/devices/${valveId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pumpDeviceId: pumpId ?? 0 }),
      });
      if (!res.ok) throw new Error();
      flash("ok", pumpId ? "Pumpe zugeordnet – sie schaltet beim Bewässern automatisch mit." : "Pumpen-Zuordnung entfernt.");
    } catch {
      setZoneList(prev);
      flash("err", "Zuordnung fehlgeschlagen.");
    }
  }, [zoneList, flash]);

  // ── Zeitplan CRUD ────────────────────────────────────────────────────────────
  const saveSchedule = useCallback(async (form: ScheduleForm) => {
    const payload = {
      deviceId: form.deviceId,
      startTime: form.startTime,
      durationMinutes: form.durationMinutes,
      daysOfWeek: form.daysOfWeek,
      isActive: form.isActive,
      skipOnRain: form.skipOnRain,
      smartRain: form.smartRain,
      sensorServiceId: form.sensorServiceId ?? null,
      moistureThresholdPct: form.sensorServiceId ? form.moistureThresholdPct : null,
      valveSequence: form.mode === "pump" ? form.valveOrder : null,
    };
    try {
      const res = editing
        ? await fetch(`/api/irrigation/schedules/${editing.id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          })
        : await fetch(`/api/irrigation/schedules`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Speichern fehlgeschlagen"); }
      const saved = (await res.json()) as Schedule & { device?: { name: string } };
      const normalized: Schedule = {
        id: saved.id, deviceId: saved.deviceId,
        deviceName: saved.device?.name ?? zoneList.find((z) => z.id === saved.deviceId)?.name ?? "Zone",
        daysOfWeek: saved.daysOfWeek, startTime: saved.startTime, durationMinutes: saved.durationMinutes,
        isActive: saved.isActive, skipOnRain: saved.skipOnRain,
        smartRain: saved.smartRain ?? false,
        sensorServiceId: saved.sensorServiceId ?? null,
        moistureThresholdPct: saved.moistureThresholdPct ?? null,
        valveSequence: Array.isArray(saved.valveSequence) ? saved.valveSequence : null,
        lastRunAt: saved.lastRunAt ?? null,
      };
      setSchedules((prev) => editing ? prev.map((s) => s.id === normalized.id ? normalized : s) : [...prev, normalized]);
      setDialogOpen(false);
      setEditing(null);
      flash("ok", editing ? "Zeitplan aktualisiert." : "Zeitplan erstellt.");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Fehler");
    }
  }, [editing, zoneList, flash]);

  const deleteSchedule = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/irrigation/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Löschen fehlgeschlagen");
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      flash("ok", "Zeitplan gelöscht.");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Fehler");
    }
  }, [flash]);

  const toggleSchedule = useCallback(async (s: Schedule) => {
    setSchedules((prev) => prev.map((x) => x.id === s.id ? { ...x, isActive: !x.isActive } : x));
    try {
      const res = await fetch(`/api/irrigation/schedules/${s.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !s.isActive }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSchedules((prev) => prev.map((x) => x.id === s.id ? { ...x, isActive: s.isActive } : x));
      flash("err", "Umschalten fehlgeschlagen.");
    }
  }, [flash]);

  // Zeitplan sofort ausfuehren – serverseitig inkl. Smart-Checks + Sequenz.
  // Wird der Start wegen Regen/Feuchte uebersprungen, kann der Nutzer per
  // Rueckfrage mit force=true trotzdem starten (Basisdauern, ohne Smart-Checks).
  const runScheduleNow = useCallback(async (s: Schedule, force = false) => {
    setBusySchedule((b) => ({ ...b, [s.id]: true }));
    try {
      const res = await fetch(`/api/irrigation/schedules/${s.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", ...(force ? { force: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Start fehlgeschlagen");
      if (data.skipped) {
        setBusySchedule((b) => ({ ...b, [s.id]: false }));
        const proceed = await askForceRun(s.deviceName, data.skipped);
        if (proceed) {
          await runScheduleNowRef.current?.(s, true);
        } else {
          flash("ok", `${s.deviceName}: nicht gestartet – ${data.skipped}`);
        }
        return;
      }
      flash("ok", s.valveSequence?.length
        ? `${s.deviceName}: Sequenz mit ${s.valveSequence.length} Ventilen gestartet.`
        : `${s.deviceName}: ${s.durationMinutes} Min gestartet.`);
      setTimeout(() => fetchStatuses(true), 3000);
      setTimeout(fetchStats, 3000);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Start fehlgeschlagen.");
    } finally {
      setBusySchedule((b) => ({ ...b, [s.id]: false }));
    }
  }, [flash, fetchStatuses, fetchStats, askForceRun]);

  // Selbstreferenz fuer den rekursiven Force-Aufruf aus der Rueckfrage.
  const runScheduleNowRef = useRef<typeof runScheduleNow | null>(null);
  runScheduleNowRef.current = runScheduleNow;

  const stopScheduleDevice = useCallback(async (s: Schedule) => {
    setBusySchedule((b) => ({ ...b, [s.id]: true }));
    try {
      const res = await fetch(`/api/irrigation/schedules/${s.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Stopp fehlgeschlagen"); }
      flash("ok", `${s.deviceName}: gestoppt.`);
      setTimeout(() => fetchStatuses(true), 3000);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Stopp fehlgeschlagen.");
    } finally {
      setBusySchedule((b) => ({ ...b, [s.id]: false }));
    }
  }, [flash, fetchStatuses]);

  // ── Abgeleitete Werte ────────────────────────────────────────────────────────
  const wateringCount = controllableIds.filter((id) => statuses[id]?.watering).length;
  const activeSchedules = schedules.filter((s) => s.isActive).length;
  const weeklyLiters = useMemo(() => {
    // Durchfluss ist in L/h gepflegt, die Laufzeit in Minuten → ÷ 60.
    const flowPerMin = (id: number) =>
      (zoneList.find((z) => z.id === id)?.flowLph ?? ASSUMED_FLOW_L_PER_HOUR) / 60;
    return schedules.filter((s) => s.isActive).reduce((sum, s) => {
      const perRun = s.valveSequence?.length
        ? s.valveSequence.reduce((acc, id) => acc + s.durationMinutes * flowPerMin(id), 0)
        : s.durationMinutes * flowPerMin(s.deviceId);
      return sum + bitCount(s.daysOfWeek) * perRun;
    }, 0);
  }, [schedules, zoneList]);
  const nextRun = useMemo(() => computeNextRun(schedules), [schedules]);

  // ── Pumpe / Durchlauf (Live) ─────────────────────────────────────────────────
  // Kandidaten fuer die Pumpen-Zuordnung: erkannte/zugeordnete Pumpen, sonst alle
  // Zonen (damit die Zuordnung auch ohne passende Benennung funktioniert).
  const pumpCandidates = useMemo(() => {
    const detected = zoneList.filter((z) => pumpIdSet.has(z.id));
    return detected.length > 0 ? detected : zoneList;
  }, [zoneList, pumpIdSet]);

  // Pumpen (eigene Gruppen) und deren Ventile.
  const pumps = useMemo(() => zoneList.filter((z) => pumpIdSet.has(z.id)), [zoneList, pumpIdSet]);
  const unassignedValves = useMemo(
    () => zoneList.filter((z) => !pumpIdSet.has(z.id) && !z.pumpDeviceId),
    [zoneList, pumpIdSet],
  );

  // Per-Pumpe Live-Kennzahlen: Durchfluss aus den aktiven zugeordneten
  // Ventilen – mit deren gepflegter Durchflussrate, sonst Standardannahme.
  const pumpStats = useMemo(() => pumps.map((p) => {
    const valves = zoneList.filter((z) => z.pumpDeviceId === p.id && !pumpIdSet.has(z.id));
    const wateringValves = valves.filter((z) => statuses[z.id]?.watering);
    const selfWatering = statuses[p.id]?.watering ?? false;
    const running = wateringValves.length > 0 || selfWatering;
    const consumerCount = wateringValves.length > 0 ? wateringValves.length : (running ? 1 : 0);
    const flowLph = wateringValves.length > 0
      ? Math.round(wateringValves.reduce((sum, z) => sum + (z.flowLph ?? ASSUMED_FLOW_L_PER_HOUR), 0))
      : (running ? (p.flowLph ?? ASSUMED_FLOW_L_PER_HOUR) : 0);
    return { pumpId: p.id, valves, running, consumerCount, flowLph };
  }), [pumps, zoneList, statuses, pumpIdSet]);

  const pumpStatsRef = useRef(pumpStats);
  pumpStatsRef.current = pumpStats;

  const [pumpRuns, setPumpRuns] = useState<Record<number, { elapsed: number; liters: number }>>({});
  const runStateRef = useRef<Record<number, { start: number | null; liters: number }>>({});
  const hadRunningRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      const next: Record<number, { elapsed: number; liters: number }> = {};
      let anyRunning = false;
      for (const st of pumpStatsRef.current) {
        const s = runStateRef.current[st.pumpId] ?? { start: null, liters: 0 };
        if (st.running) {
          anyRunning = true;
          if (s.start == null) { s.start = Date.now(); s.liters = 0; }
          s.liters += st.flowLph / 3600; // L/h → Liter pro Sekunde
          next[st.pumpId] = { elapsed: Math.round((Date.now() - s.start) / 1000), liters: s.liters };
        } else {
          if (s.start != null) { s.start = null; s.liters = 0; }
          next[st.pumpId] = { elapsed: 0, liters: 0 };
        }
        runStateRef.current[st.pumpId] = s;
      }
      // Nur rendern, wenn etwas laeuft oder gerade gestoppt wurde.
      if (anyRunning || hadRunningRef.current) setPumpRuns(next);
      hadRunningRef.current = anyRunning;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Nicht verbunden / keine Zonen ────────────────────────────────────────────
  if (!connected || zoneList.length === 0) {
    return (
      <div className="page-content">
        <Card className="max-w-2xl py-0 sm:py-0">
          <EmptyState
            icon={Sprout}
            title={connected ? "Noch keine Bewässerungs-Zonen" : "GARDENA nicht verbunden"}
            description={connected
              ? "Importiere deine GARDENA-Ventile und Pumpen, um sie hier als Zonen zu steuern."
              : "Verbinde dein GARDENA smart system und importiere die Ventile/Pumpen, um die smarte Bewässerung zu nutzen."}
            action={
              <Button asChild className="max-sm:h-11">
                <Link href="/settings">Zu den Einstellungen</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const LevelIcon = LEVEL_STYLES[recommendation.level].icon;
  const next = nextRun ? fmtNext(nextRun.when) : null;

  return (
    <div className="page-content max-w-6xl space-y-4 sm:space-y-5">
      {/* Banner */}
      {banner && (
        <Notice
          tone={banner.type === "ok" ? "success" : "danger"}
          icon={banner.type === "ok" ? CheckCircle2 : CircleAlert}
          compact
          title={banner.msg}
        />
      )}

      {/* Wetter + Empfehlung: Glaskarte statt Farbverlauf mit weißer Schrift (docs/design-regeln.md, Abschnitt 15). */}
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 sm:gap-4">
            <IconChip icon={LevelIcon} tone="water" size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label">Smarte Empfehlung</span>
                <Badge variant={LEVEL_STYLES[recommendation.level].variant}>
                  {LEVEL_STYLES[recommendation.level].label}
                </Badge>
              </div>
              <p className="text-base sm:text-lg font-medium mt-1 max-w-xl text-foreground">{recommendation.reason}</p>
            </div>
          </div>
          {weather && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm tabular-nums">
              <div className="flex items-center gap-1.5" title="Aktuelle Temperatur">
                <Thermometer className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{weather.currentTemp != null ? `${Math.round(weather.currentTemp)}°` : "—"}</span>
              </div>
              <div className="flex items-center gap-1.5" title="Höchsttemperatur heute">
                <Sun className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{weather.tempMaxToday != null ? `${Math.round(weather.tempMaxToday)}°` : "—"}</span>
              </div>
              <div className="flex items-center gap-1.5" title="Regen heute">
                <CloudRain className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">
                  {weather.precipProbToday != null ? `${Math.round(weather.precipProbToday)}%` : "—"}
                  {weather.precipSumToday != null && weather.precipSumToday > 0 ? ` · ${weather.precipSumToday.toFixed(1)}mm` : ""}
                </span>
              </div>
              {weather.et0Today != null && (
                <div className="flex items-center gap-1.5" title="Verdunstung heute (ET₀) – Basis der Wasserbilanz">
                  <Waves className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{weather.et0Today.toFixed(1)}mm</span>
                </div>
              )}
            </div>
          )}
        </CardContent>

        {/* Smart-Run-Leiste */}
        <CardContent className="border-t border-border pt-4">
          {run ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                {/* Laufende Bewässerung in Himmelblau (Wasser), docs/design-regeln.md, Abschnitt 3. */}
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-sky-600 dark:text-sky-400" />
                  Zone {run.index + 1}/{run.total}: <span className="text-sky-700 dark:text-sky-300">{run.zoneName}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="tabular-nums">{fmtCountdown(run.remainingSec)}</span>
                </div>
                <Button size="sm" variant="destructive" onClick={stopSmartRun} className="max-sm:h-11">
                  <Square className="h-4 w-4" /> Alles stoppen
                </Button>
              </div>
              <div className="h-2 rounded-full bg-foreground/[0.08] dark:bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${((run.index + (1 - run.remainingSec / (run.minutes * 60))) / run.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Smart-Bewässerung starten</p>
                  <p className="text-xs text-muted-foreground">
                    Alle Zonen nacheinander · {recommendedMinutes(baseMinutes, recommendation) || baseMinutes} Min/Zone
                    {!recommendation.shouldWater && " · heute laut Wetter nicht nötig"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">Basis</Label>
                  <Select value={String(baseMinutes)} onValueChange={(v) => setBaseMinutes(Number(v))}>
                    <SelectTrigger size="sm" className="w-[92px] max-sm:data-[size=sm]:h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DURATION_PRESETS.map((d) => <SelectItem key={d} value={String(d)}>{d} Min</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={startSmartRun} className="max-sm:h-11">
                  <Play className="h-4 w-4" /> Starten
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistik: Anzahlen und Termine sind kein Zustand, daher neutral (docs/design-regeln.md, Abschnitt 3).
          Abstand wie die Kennzahlen auf /network (Karten 16 px ab sm, Abschnitt 5). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={Droplets} label="Ventile" value={`${zoneList.length - pumps.length}`} hint={`${pumps.length} Pumpe${pumps.length === 1 ? "" : "n"} · ${wateringCount} aktiv`} tone="neutral" />
        <StatCard icon={CalendarDays} label="Aktive Zeitpläne" value={`${activeSchedules}`} hint={`${schedules.length} gesamt`} tone="neutral" />
        <StatCard icon={Gauge} label="Verbrauch / Woche" value={`${(weeklyLiters / 1000).toFixed(weeklyLiters >= 1000 ? 1 : 0)}${weeklyLiters >= 1000 ? " m³" : " L"}`} hint="geschätzt" tone="neutral" />
        <StatCard icon={Clock} label="Nächste Bewässerung" value={next?.time ?? "—"} hint={nextRun && next ? `${next.day} · ${nextRun.label}` : "kein Zeitplan"} tone="neutral" />
      </div>

      {/* Zonen nach Pumpe gruppiert */}
      <div className="space-y-3">
        <SectionHeading
          title="Bewässerung"
          icon={Droplets}
          aside={
            <Button variant="ghost" size="sm" onClick={() => fetchStatuses(true)} disabled={statusLoading} className="text-muted-foreground max-sm:h-11">
              <RefreshCw className={cn("h-4 w-4", statusLoading && "animate-spin")} /> Aktualisieren
            </Button>
          }
        />

        <div className="space-y-4 sm:space-y-5">
          {pumps.map((pump) => {
            const st = pumpStats.find((s) => s.pumpId === pump.id);
            const valves = st?.valves ?? [];
            const pr = pumpRuns[pump.id] ?? { elapsed: 0, liters: 0 };
            return (
              <PumpGroup
                key={pump.id}
                pump={pump}
                pumpStatus={statuses[pump.id]}
                running={st?.running ?? false}
                flowLph={st?.flowLph ?? 0}
                elapsed={pr.elapsed}
                liters={pr.liters}
                consumerCount={st?.consumerCount ?? 0}
                valveCount={valves.length}
                duration={durations[pump.id] ?? 15}
                busy={!!busyZone[pump.id]}
                disabled={!!run}
                onDuration={(m) => setDurations((d) => ({ ...d, [pump.id]: m }))}
                onStart={() => startZone(pump)}
                onStop={() => stopZone(pump)}
                onRename={(name) => renameZone(pump.id, name)}
              >
                {valves.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Droplet}
                    title="Noch keine Ventile zugeordnet – wähle in einer Ventil-Karte unten diese Pumpe aus."
                    className="col-span-full"
                  />
                ) : (
                  valves.map((zone) => (
                    <ZoneCard
                      key={zone.id}
                      zone={zone}
                      status={statuses[zone.id]}
                      duration={durations[zone.id] ?? 15}
                      recommended={recommendedMinutes(baseMinutes, recommendation)}
                      busy={!!busyZone[zone.id]}
                      disabled={!!run}
                      isPump={false}
                      pumpOptions={pumpCandidates.filter((p) => p.id !== zone.id)}
                      onDuration={(m) => setDurations((d) => ({ ...d, [zone.id]: m }))}
                      onStart={() => startZone(zone)}
                      onStop={() => stopZone(zone)}
                      onRename={(name) => renameZone(zone.id, name)}
                      onAssignPump={(pumpId) => assignPump(zone.id, pumpId)}
                      onUpdateMeta={(flow, area) => updateZoneMeta(zone.id, flow, area)}
                    />
                  ))
                )}
              </PumpGroup>
            );
          })}

          {unassignedValves.length > 0 && (
            <Card className="gap-3 px-4 sm:px-[18px]">
              <div className="flex items-center gap-2">
                <Droplet className="h-4 w-4 text-muted-foreground" />
                <CardTitle>
                  <h3>Ohne Pumpe</h3>
                </CardTitle>
                <span className="text-xs text-muted-foreground tabular-nums">{unassignedValves.length} Ventil{unassignedValves.length === 1 ? "" : "e"}</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {unassignedValves.map((zone) => (
                  <ZoneCard
                    key={zone.id}
                    zone={zone}
                    status={statuses[zone.id]}
                    duration={durations[zone.id] ?? 15}
                    recommended={recommendedMinutes(baseMinutes, recommendation)}
                    busy={!!busyZone[zone.id]}
                    disabled={!!run}
                    isPump={false}
                    pumpOptions={pumpCandidates.filter((p) => p.id !== zone.id)}
                    onDuration={(m) => setDurations((d) => ({ ...d, [zone.id]: m }))}
                    onStart={() => startZone(zone)}
                    onStop={() => stopZone(zone)}
                    onRename={(name) => renameZone(zone.id, name)}
                    onAssignPump={(pumpId) => assignPump(zone.id, pumpId)}
                    onUpdateMeta={(flow, area) => updateZoneMeta(zone.id, flow, area)}
                  />
                ))}
              </div>
            </Card>
          )}

          {pumps.length === 0 && unassignedValves.length === 0 && (
            <Card className="py-0 sm:py-0">
              <EmptyState compact icon={Droplets} title="Keine Zonen vorhanden." />
            </Card>
          )}
        </div>
      </div>

      {/* Zeitpläne */}
      <div className="space-y-3">
        <SectionHeading
          title="Zeitpläne"
          icon={CalendarDays}
          aside={
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} className="max-sm:h-11">
              <Plus className="h-4 w-4" /> Neuer Zeitplan
            </Button>
          }
        />
        {/* Zeilen mit Haarlinie in einer Karte (docs/design-regeln.md, Abschnitt 17). */}
        <Card className="gap-0 overflow-hidden py-0 sm:py-0">
          <CardContent className="px-0 sm:px-0 divide-y divide-border">
            {schedules.length === 0 ? (
              <EmptyState
                compact
                icon={CalendarDays}
                title="Noch keine Zeitpläne."
                description="Lege einen an, damit die Bewässerung automatisch (wetterabhängig) läuft."
              />
            ) : (
              schedules.map((s) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  sequenceNames={(s.valveSequence ?? []).map((id) => zoneList.find((z) => z.id === id)?.name ?? `#${id}`)}
                  sensor={s.sensorServiceId ? sensors.find((x) => x.serviceId === s.sensorServiceId) : undefined}
                  running={
                    !!statuses[s.deviceId]?.watering ||
                    (s.valveSequence ?? []).some((id) => statuses[id]?.watering)
                  }
                  busy={!!busySchedule[s.id]}
                  onToggle={() => toggleSchedule(s)}
                  onRunNow={() => runScheduleNow(s)}
                  onStop={() => stopScheduleDevice(s)}
                  onEdit={() => { setEditing(s); setDialogOpen(true); }}
                  onDelete={() => { setScheduleToDelete(s); setDeleteOpen(true); }}
                />
              ))
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          Zeitpläne werden serverseitig automatisch ausgeführt (alle 5 Min geprüft). „Bei Regen aussetzen“ nutzt die Wetterprognose.
        </p>
      </div>

      {/* Statistik / Laufhistorie */}
      <IrrigationStatsPanel
        stats={stats}
        loading={statsLoading}
        days={statsDays}
        onDaysChange={setStatsDays}
        onRefresh={fetchStats}
      />

      {dialogOpen && (
        <ScheduleDialog
          onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}
          zones={zoneList}
          pumps={pumps}
          sensors={sensors}
          editing={editing}
          onSave={saveSchedule}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {scheduleToDelete ? `Zeitplan „${scheduleToDelete.deviceName} · ${scheduleToDelete.startTime}“ wirklich löschen?` : ""}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (scheduleToDelete) void deleteSchedule(scheduleToDelete.id);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={forceOpen}
        onOpenChange={(o) => {
          setForceOpen(o);
          // Nach „Trotzdem starten“ ist die Antwort schon gegeben, ein zweites Auflösen bleibt wirkungslos.
          if (!o) forceAsk?.answer(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{forceAsk ? `${forceAsk.name} wurde nicht gestartet` : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">{forceAsk?.reason}</span>
              <span className="mt-2 block">Trotzdem mit den geplanten Dauern starten?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => forceAsk?.answer(true)}>Trotzdem starten</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function emptyStatus(id: number): ZoneStatus {
  return { id, online: true, activity: null, watering: false, batteryLevel: null, batteryState: null, modelType: null, source: "cloud" };
}

/// ── Pumpen-Gruppe (Pumpe + zugeordnete Ventile) ──────────────────────────────

function PumpGroup({
  pump, pumpStatus, running, flowLph, elapsed, liters, consumerCount, valveCount,
  duration, busy, disabled, onDuration, onStart, onStop, onRename, children,
}: {
  pump: Zone; pumpStatus?: ZoneStatus; running: boolean; flowLph: number; elapsed: number;
  liters: number; consumerCount: number; valveCount: number; duration: number; busy: boolean;
  disabled: boolean; onDuration: (m: number) => void; onStart: () => void; onStop: () => void;
  onRename: (name: string) => void; children: React.ReactNode;
}) {
  const online = pumpStatus?.online;
  const battery = pumpStatus?.batteryLevel ?? null;
  const watering = pumpStatus?.watering ?? false;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pump.name);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== pump.name) onRename(draft.trim());
    else setDraft(pump.name);
  };

  return (
    // Eigene Glaskarte je Pumpe; läuft sie, färbt sich die Karte im Wasser-Ton
    // (docs/design-regeln.md, Abschnitte 2 und 3).
    <section className={cn(
      "glass-card overflow-hidden",
      running && "border-sky-400/45 bg-gradient-to-b from-sky-500/12 to-transparent",
    )}>
      {/* Pumpen-Kopf */}
      <div className="p-4 sm:p-[18px] space-y-4 border-b border-border">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <IconChip icon={Activity} tone="water" active={running} size="lg" />
            <div className="min-w-0">
              {editing ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") { setEditing(false); setDraft(pump.name); }
                    }}
                    className="h-8 py-1 max-sm:h-11"
                  />
                  <Button variant="ghost" size="icon-sm" onClick={commitRename} className="text-primary max-sm:size-11" title="Speichern" aria-label="Speichern">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(false); setDraft(pump.name); }} className="text-muted-foreground hover:text-foreground max-sm:size-11" title="Abbrechen" aria-label="Abbrechen">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="group/pname flex items-center gap-1.5">
                  <p className="font-semibold text-foreground truncate">{pump.name}</p>
                  <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
                    <Activity className="h-3 w-3" /> Pumpe
                  </Badge>
                  {/* Tippfläche 44 × 34 px: wächst seitlich und nach oben, nach unten nur bis
                      vor die Zeile „n Ventile“, damit ein Tipp dort nicht umbenennt. */}
                  <button
                    onClick={() => { setDraft(pump.name); setEditing(true); }}
                    className="opacity-0 group-hover/pname:opacity-100 focus-visible:opacity-100 max-sm:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0 relative rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 after:absolute after:-inset-x-[15px] after:-top-4 after:-bottom-1 after:content-['']"
                    title="Umbenennen"
                    aria-label="Umbenennen"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                {running ? `${consumerCount} von ${valveCount} Ventil${valveCount === 1 ? "" : "en"} aktiv` : `${valveCount} Ventil${valveCount === 1 ? "" : "e"}`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {online != null && (
              online ? (
                <Badge variant="success" className="text-[10px] gap-1">
                  <Wifi className="h-3 w-3" /> Online
                </Badge>
              ) : (
                <Badge variant="neutral" className="text-[10px] gap-1">
                  <WifiOff className="h-3 w-3" /> Offline
                </Badge>
              )
            )}
            {/* Schwacher Akku ist ein Hinweis (warning), keine Störung (docs/design-regeln.md, Abschnitt 3). */}
            {battery != null && (
              <span className={cn("text-[10px] tabular-nums flex items-center gap-0.5", battery <= 20 ? "text-warning" : "text-muted-foreground")}>
                {battery <= 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />} {battery}%
              </span>
            )}
            <Badge
              variant={running ? "default" : "neutral"}
              className={cn("gap-1.5 text-[11px] font-medium", running && "bg-sky-500/15 text-sky-700 dark:text-sky-300")}
            >
              {running ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                </span>
              ) : (
                <StatusDot tone="neutral" />
              )}
              {running ? "Läuft" : "Aus"}
            </Badge>
          </div>
        </div>

        {/* Live-Kennzahlen: vier Spalten erst ab lg, sonst kürzen die Versalien-Beschriftungen
            neben der Seitenleiste (iPad hochkant) ab. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <PumpMetric icon={Waves} accent={running ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"} label="Durchfluss" value={running ? `${flowLph}` : "0"} unit="L/h" />
          <PumpMetric icon={Timer} accent="text-muted-foreground" label="Laufzeit" value={fmtCountdown(elapsed)} unit="min" />
          <PumpMetric icon={Droplet} accent={running ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"} label="Durchlauf" value={fmtLiters(liters)} unit="" />
          <PumpMetric icon={Droplets} accent="text-muted-foreground" label="Aktive Ventile" value={`${consumerCount}`} unit={`/ ${valveCount}`} />
        </div>

        {/* Fluss-Animation: Streifen im Wasser-Ton aus den Theme-Variablen statt fester RGB-Werte. */}
        <div className="h-2 rounded-full bg-foreground/[0.08] dark:bg-white/[0.08] overflow-hidden">
          {running && (
            <div
              className="h-full w-full animate-pump-flow motion-reduce:animate-none"
              style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--color-sky-400) 0, var(--color-sky-400) 8px, var(--color-sky-600) 8px, var(--color-sky-600) 16px)" }}
            />
          )}
        </div>

        {/* Manuelle Pumpen-Steuerung */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Dauer-Chips umbrechen in schmalen Breiten (eine Segmentwahl würde waagerecht scrollen). */}
          <div className="flex flex-wrap gap-1">
            {DURATION_PRESETS.map((d) => (
              <button
                key={d}
                onClick={() => onDuration(d)}
                disabled={disabled || watering}
                aria-pressed={duration === d}
                className={cn(DURATION_CHIP, duration === d ? DURATION_CHIP_ON : DURATION_CHIP_OFF)}
              >
                {d}′
              </button>
            ))}
          </div>
          {watering ? (
            <Button onClick={onStop} disabled={busy || disabled} variant="destructive" size="sm" className="ml-auto max-sm:h-11">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Square className="h-4 w-4" /> Pumpe stoppen</>}
            </Button>
          ) : (
            <Button onClick={onStart} disabled={busy || disabled || !pump.serviceId} size="sm" className="ml-auto max-sm:h-11">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Play className="h-4 w-4" /> {duration} Min laufen</>}
            </Button>
          )}
        </div>
      </div>

      {/* Zugeordnete Ventile */}
      <div className="p-4 sm:p-[18px]">
        <p className="text-label mb-2">Zugeordnete Ventile</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {children}
        </div>
      </div>
    </section>
  );
}

function PumpMetric({ icon: Icon, accent, label, value, unit }: {
  icon: React.ComponentType<{ className?: string }>; accent: string; label: string; value: string; unit: string;
}) {
  // Kennzahl in einer Karte: Kachel im Stil von StatCard (sm), aber als glass-tile,
  // weil StatCard selbst eine Glaskarte mit Weichzeichner ist (docs/design-regeln.md, Abschnitt 22).
  return (
    <div className="glass-tile px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-label text-[10px] tracking-[0.1em] truncate">{label}</span>
        <Icon className={cn("ml-auto h-3.5 w-3.5 shrink-0", accent)} />
      </div>
      <p className="mt-1 text-xl font-bold leading-none tracking-tight text-foreground tabular-nums truncate">
        {value}{unit && <span className="text-xs font-medium tracking-normal text-muted-foreground ml-1">{unit}</span>}
      </p>
    </div>
  );
}

// ── Zonen-Karte ──────────────────────────────────────────────────────────────

// Klare An/Aus-Anzeige des Ventils.
function ZoneStateBadge({ status }: { status?: ZoneStatus }) {
  const base = "gap-1.5 text-[11px] font-medium";

  if (!status || status.source === "unavailable") {
    return (
      <Badge variant="outline" className={cn(base, "text-muted-foreground")}>
        <StatusDot tone="neutral" />
        Status unbekannt
      </Badge>
    );
  }

  if (status.watering) {
    const label = status.activity === "SCHEDULED_WATERING" ? "An · Zeitplan" : "An · bewässert";
    // Ventil offen = Wasser-Zustand in Himmelblau (docs/design-regeln.md, Abschnitt 3).
    return (
      <Badge className={cn(base, "bg-sky-500/15 text-sky-700 dark:text-sky-300")}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
        </span>
        {label}
      </Badge>
    );
  }

  if (status.activity === "PAUSED") {
    return (
      <Badge variant="warning" className={base}>
        <StatusDot tone="warning" />
        Pausiert
      </Badge>
    );
  }

  return (
    <Badge variant="neutral" className={base}>
      <StatusDot tone="neutral" />
      Aus · geschlossen
    </Badge>
  );
}

function ZoneCard({ zone, status, duration, recommended, busy, disabled, isPump, pumpOptions, onDuration, onStart, onStop, onRename, onAssignPump, onUpdateMeta }: {
  zone: Zone; status?: ZoneStatus; duration: number; recommended: number; busy: boolean; disabled: boolean;
  isPump: boolean; pumpOptions: Zone[];
  onDuration: (m: number) => void; onStart: () => void; onStop: () => void; onRename: (name: string) => void;
  onAssignPump: (pumpId: number | null) => void;
  onUpdateMeta: (flowLph: number | null, areaSqm: number | null) => void;
}) {
  const watering = status?.watering ?? false;
  const online = status?.online ?? false;
  const battery = status?.batteryLevel ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(zone.name);
  const [flowDraft, setFlowDraft] = useState(zone.flowLph != null ? String(zone.flowLph) : "");
  const [areaDraft, setAreaDraft] = useState(zone.areaSqm != null ? String(zone.areaSqm) : "");

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== zone.name) onRename(draft.trim());
    else setDraft(zone.name);
  };

  // Stammdaten speichern (bei Blur/Enter), wenn sich etwas geaendert hat.
  const commitMeta = () => {
    const parse = (s: string) => {
      const n = Number(s.trim().replace(",", "."));
      return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
    };
    const flow = parse(flowDraft);
    const area = parse(areaDraft);
    if (flow === (zone.flowLph ?? null) && area === (zone.areaSqm ?? null)) return;
    onUpdateMeta(flow, area);
  };

  return (
    // Kachel in der Pumpen-Karte; bewässert sie, leuchtet sie im Wasser-Ton
    // (aktive Kachel, docs/design-regeln.md, Abschnitt 15).
    <div className={cn(
      "glass-tile p-3 sm:p-4",
      watering && "border-sky-400/45 bg-gradient-to-br from-sky-400/25 to-sky-400/5",
    )}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <IconChip icon={Droplets} tone="water" active={watering} />
            <div className="min-w-0 flex-1">
              {editing ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") { setEditing(false); setDraft(zone.name); }
                    }}
                    className="h-8 py-1 max-sm:h-11"
                  />
                  <Button variant="ghost" size="icon-sm" onClick={commitRename} className="text-primary max-sm:size-11" title="Speichern" aria-label="Speichern">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(false); setDraft(zone.name); }} className="text-muted-foreground hover:text-foreground max-sm:size-11" title="Abbrechen" aria-label="Abbrechen">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="group/name flex items-center gap-1">
                  <p className="font-medium text-foreground truncate">{zone.name}</p>
                  {isPump && (
                    <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
                      <Activity className="h-3 w-3" /> Pumpe
                    </Badge>
                  )}
                  {/* Tippfläche 44 × 34 px: wächst seitlich und nach oben, nach unten nur bis
                      vor den Zustand darunter, damit ein Tipp dort nicht umbenennt. */}
                  <button
                    onClick={() => { setDraft(zone.name); setEditing(true); }}
                    className="opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100 max-sm:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0 relative rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 after:absolute after:-inset-x-[15px] after:-top-4 after:-bottom-1 after:content-['']"
                    title="Umbenennen"
                    aria-label="Umbenennen"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="mt-1"><ZoneStateBadge status={status} /></div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {online ? (
              <Badge variant="success" className="text-[10px] gap-1">
                <Wifi className="h-3 w-3" /> Online
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px] gap-1">
                <WifiOff className="h-3 w-3" /> Offline
              </Badge>
            )}
            {battery != null && (
              <span className={cn("text-[10px] tabular-nums flex items-center gap-0.5", battery <= 20 ? "text-warning" : "text-muted-foreground")}>
                {battery <= 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />} {battery}%
              </span>
            )}
          </div>
        </div>

        {/* Dauer-Picker */}
        <div className="flex flex-wrap gap-1">
          {DURATION_PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => onDuration(d)}
              disabled={disabled || watering}
              aria-pressed={duration === d}
              className={cn(DURATION_CHIP, duration === d ? DURATION_CHIP_ON : DURATION_CHIP_OFF)}
            >
              {d}′
            </button>
          ))}
          {recommended > 0 && recommended !== duration && (
            <button
              onClick={() => onDuration(recommended)}
              disabled={disabled || watering}
              className={cn(DURATION_CHIP, "inline-flex items-center gap-1 bg-primary/12 text-primary hover:bg-primary/20")}
              title="Wetter-Empfehlung übernehmen"
            >
              <Sparkles className="h-3 w-3" /> {recommended}′
            </button>
          )}
        </div>

        {/* Zonen-Stammdaten: Durchsatz + Flaeche fuer die Wasserbilanz */}
        <div className="flex items-center gap-2" title="Zonen-Daten für die Wasserbilanz: Durchflussrate und bewässerte Fläche">
          <Waves className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Input
              type="number"
              inputMode="decimal"
              min={1}
              placeholder="720"
              value={flowDraft}
              onChange={(e) => setFlowDraft(e.target.value)}
              onBlur={commitMeta}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              aria-label="Durchfluss in L/h"
              className="px-2 max-sm:h-11"
            />
            <span className="text-[10px] text-muted-foreground shrink-0">L/h</span>
          </div>
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Input
              type="number"
              inputMode="decimal"
              min={1}
              placeholder="–"
              value={areaDraft}
              onChange={(e) => setAreaDraft(e.target.value)}
              onBlur={commitMeta}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              aria-label="Bewässerte Fläche in m²"
              className="px-2 max-sm:h-11"
            />
            <span className="text-[10px] text-muted-foreground shrink-0">m²</span>
          </div>
        </div>

        {/* Pumpen-Zuordnung (nur fuer Ventile, nicht fuer die Pumpe selbst) */}
        {!isPump && pumpOptions.length > 0 && (
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Select
              value={zone.pumpDeviceId ? String(zone.pumpDeviceId) : "none"}
              onValueChange={(v) => onAssignPump(v === "none" ? null : Number(v))}
              disabled={disabled}
            >
              <SelectTrigger size="sm" className="flex-1 text-xs max-sm:data-[size=sm]:h-11">
                <SelectValue placeholder="Pumpe zuordnen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Keine Pumpe</SelectItem>
                {pumpOptions.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Aktionen */}
        <div className="flex gap-2">
          {watering ? (
            <Button onClick={onStop} disabled={busy || disabled} variant="destructive" className="flex-1 max-sm:h-11">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Square className="h-4 w-4" /> Stopp</>}
            </Button>
          ) : (
            <Button onClick={onStart} disabled={busy || disabled || !zone.serviceId} className="flex-1 max-sm:h-11">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Play className="h-4 w-4" /> {duration} Min bewässern</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Zeitplan-Zeile ───────────────────────────────────────────────────────────

function ScheduleRow({ schedule, sequenceNames, sensor, running, busy, onToggle, onRunNow, onStop, onEdit, onDelete }: {
  schedule: Schedule; sequenceNames: string[]; sensor?: SoilSensor; running: boolean; busy: boolean;
  onToggle: () => void; onRunNow: () => void; onStop: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const humidity = sensor?.soilHumidity ?? null;
  const threshold = schedule.moistureThresholdPct;
  const moistEnough = humidity != null && threshold != null && humidity >= threshold;
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:px-[18px] transition-colors",
      running && "bg-sky-500/10",
    )}>
      <div className="flex flex-col items-center gap-1 shrink-0">
        <Switch checked={schedule.isActive} onCheckedChange={onToggle} title={schedule.isActive ? "Aktiv – klicken zum Pausieren" : "Pausiert – klicken zum Aktivieren"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("font-medium truncate", schedule.isActive ? "text-foreground" : "text-muted-foreground")}>
            {schedule.deviceName}
          </span>
          {running ? (
            <Badge className="text-[10px] gap-1 bg-sky-500/15 text-sky-700 dark:text-sky-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
              </span>
              Läuft
            </Badge>
          ) : schedule.isActive ? (
            <Badge variant="success" className="text-[10px] gap-1">
              <StatusDot tone="success" size="xs" /> Aktiv
            </Badge>
          ) : (
            <Badge variant="neutral" className="text-[10px] gap-1">
              <StatusDot tone="neutral" size="xs" /> Pausiert
            </Badge>
          )}
          {sequenceNames.length > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Activity className="h-3 w-3" /> {sequenceNames.length} Ventile
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px] gap-1 tabular-nums">
            <Clock className="h-3 w-3" /> {schedule.startTime}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {schedule.durationMinutes} Min{sequenceNames.length > 0 ? "/Ventil" : ""}
          </Badge>
          {schedule.skipOnRain && (
            <Badge variant="info" className="text-[10px] gap-1">
              <CloudRain className="h-3 w-3" /> Regen-Stopp
            </Badge>
          )}
          {schedule.smartRain && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 text-primary border-primary/30 dark:border-primary/30"
              title="Dauer wird aus der Wasserbilanz berechnet (Verdunstung ET₀ − Regen seit letztem Lauf)"
            >
              <Sparkles className="h-3 w-3" /> Wasserbilanz
            </Badge>
          )}
          {schedule.sensorServiceId && (
            <>
              {/* Sensor ohne Messwert ist ein Hinweis, „setzt aus“ informiert wie Regen-Stopp,
                  trockener Boden ist der Normalfall (docs/design-regeln.md, Abschnitt 3). */}
              <Badge
                variant={humidity == null ? "warning" : moistEnough ? "info" : "neutral"}
                className="text-[10px] gap-1"
                title={sensor
                  ? [
                      `${sensor.name}`,
                      humidity != null ? `Bodenfeuchte: ${Math.round(humidity)} %` : "Bodenfeuchte: unbekannt",
                      sensor.soilTemperature != null ? `Bodentemperatur: ${Math.round(sensor.soilTemperature)} °C` : null,
                      sensor.batteryLevel != null ? `Akku: ${Math.round(sensor.batteryLevel)} %` : null,
                      fmtSensorAge(sensor.soilHumidityAt) ? `Messung ${fmtSensorAge(sensor.soilHumidityAt)}` : null,
                      `Schwelle: ${threshold} % (aussetzen ab Schwelle)`,
                    ].filter(Boolean).join(" · ")
                  : "Sensor derzeit nicht erreichbar"}
              >
                <Sprout className="h-3 w-3" />
                Boden {humidity != null ? `${Math.round(humidity)}%` : "—"} / {threshold}%
                {moistEnough && " · setzt aus"}
              </Badge>
              {sensor?.batteryLevel != null && (
                <Badge variant="neutral" className="text-[10px] gap-1 tabular-nums">
                  <Battery className="h-3 w-3" /> Akku {Math.round(sensor.batteryLevel)}%
                </Badge>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {fmtDays(schedule.daysOfWeek)}
          {sequenceNames.length > 0 && <> · {sequenceNames.join(" → ")}</>}
          {schedule.lastRunAt && <> · Zuletzt: {fmtLastRun(schedule.lastRunAt)}</>}
        </p>
      </div>
      {/* Auf dem Handy rutschen die Tasten unter den Text, damit er Platz hat. */}
      <div className="flex items-center gap-1 shrink-0 max-sm:w-full max-sm:justify-end">
        {running ? (
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 max-sm:h-11" onClick={onStop} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Square className="h-3.5 w-3.5" /> Stopp</>}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 max-sm:h-11" onClick={onRunNow} disabled={busy} title="Zeitplan jetzt ausführen">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Play className="h-3.5 w-3.5" /> Jetzt</>}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground max-sm:size-11" onClick={onEdit} aria-label="Bearbeiten">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive max-sm:size-11" onClick={onDelete} aria-label="Löschen">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** „Heute 20:00" / „Gestern 21:00" / „Mo 06:00" bzw. Datum. */
function fmtLastRun(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Heute ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Gestern ${time}`;
  return `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

// ── Statistik (Laufhistorie) ─────────────────────────────────────────────────

function IrrigationStatsPanel({
  stats, loading, days, onDaysChange, onRefresh,
}: {
  stats: IrrigationStatsResponse | null;
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  onRefresh: () => void;
}) {
  const dayOptions = [7, 14, 30] as const;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading title="Statistik" icon={BarChart3} />
        {/* Zeitraum als Segmentwahl (docs/design-regeln.md, Abschnitt 6). */}
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            aria-label="Zeitraum"
            value={String(days)}
            onValueChange={(v) => onDaysChange(Number(v))}
            options={dayOptions.map((d) => ({ value: String(d), label: `${d} Tage` }))}
          />
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="text-muted-foreground max-sm:h-11">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Aktualisieren
          </Button>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0 sm:py-0">
        <CardContent className="px-0 sm:px-0">
          {loading && !stats ? (
            <div className="p-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Statistik wird geladen…
            </div>
          ) : !stats || stats.summary.runCount === 0 ? (
            <EmptyState
              icon={History}
              title="Noch keine Läufe im gewählten Zeitraum"
              description="Ab jetzt werden alle Bewässerungen (Zeitplan, „Jetzt“ und manuelle Starts) automatisch protokolliert."
            />
          ) : (
            <>
              <div className="px-4 py-3 sm:px-[18px] border-b border-border bg-glass-tile flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  <span className="font-semibold tabular-nums">{stats.summary.totalMinutes}</span> Min gesamt
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  <span className="font-semibold tabular-nums">{fmtLiters(stats.summary.totalLiters)}</span> geschätzt
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  <span className="font-semibold tabular-nums">{stats.summary.runCount}</span> Läufe
                </span>
              </div>
              <div className="divide-y divide-border">
                {stats.days.map((day) => (
                  <div key={day.date} className="p-4 sm:px-[18px]">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <p className="text-sm font-semibold text-foreground">{day.label}</p>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {day.totalMinutes} Min · {fmtLiters(day.totalLiters)} · {day.runCount} Läufe
                      </span>
                    </div>
                    <div className="space-y-3">
                      {day.valves.map((valve) => (
                        <div key={valve.deviceId} className="glass-tile overflow-hidden">
                          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                            <div className="flex items-center gap-2 min-w-0">
                              <Droplets className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                              <span className="text-sm font-medium text-foreground/90 truncate">{valve.deviceName}</span>
                            </div>
                            <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">
                              {valve.totalMinutes} Min
                              {valve.runCount > 1 && ` (${valve.runCount}×)`}
                            </span>
                          </div>
                          <ul className="divide-y divide-border">
                            {valve.runs.map((run) => (
                              <li key={run.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                                <span className="tabular-nums">{fmtRunTime(run.startedAt)}</span>
                                <span className="flex items-center gap-2">
                                  <span className="tabular-nums font-medium text-foreground/80">{run.durationMinutes} Min</span>
                                  {run.litersEstimate != null && (
                                    <span className="text-muted-foreground">· {fmtLiters(run.litersEstimate)}</span>
                                  )}
                                  <Badge variant="outline" className="text-[10px] h-5 px-1.5">{run.sourceLabel}</Badge>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <History className="h-3.5 w-3.5 shrink-0" />
        Verbrauch geschätzt aus Durchflussrate (L/h) der Zone, sonst 720 L/h Standard.
      </p>
    </div>
  );
}

// ── Zeitplan-Dialog ──────────────────────────────────────────────────────────

interface ScheduleForm {
  /// "pump" = Pumpen-Zeitplan mit Ventil-Sequenz, "single" = einzelnes Ventil.
  mode: "pump" | "single";
  /// Ziel: bei "pump" die Pumpe, bei "single" das Ventil.
  deviceId: number;
  /// Geordnete Ventil-IDs (nur mode = "pump").
  valveOrder: number[];
  startTime: string;
  durationMinutes: number;
  daysOfWeek: number;
  isActive: boolean;
  skipOnRain: boolean;
  smartRain: boolean;
  sensorServiceId: string | null;
  moistureThresholdPct: number;
}

function ScheduleDialog({ onOpenChange, zones, pumps, sensors, editing, onSave }: {
  onOpenChange: (o: boolean) => void; zones: Zone[]; pumps: Zone[]; sensors: SoilSensor[]; editing: Schedule | null;
  onSave: (form: ScheduleForm) => void;
}) {
  const valvesOfPump = useCallback(
    (pumpId: number) => zones.filter((z) => z.pumpDeviceId === pumpId).map((z) => z.id),
    [zones],
  );

  const [form, setForm] = useState<ScheduleForm>(() => {
    if (editing) {
      const isPump = !!editing.valveSequence?.length;
      return {
        mode: isPump ? "pump" : "single",
        deviceId: editing.deviceId,
        valveOrder: editing.valveSequence ?? [],
        startTime: editing.startTime, durationMinutes: editing.durationMinutes,
        daysOfWeek: editing.daysOfWeek, isActive: editing.isActive,
        skipOnRain: editing.skipOnRain, smartRain: editing.smartRain,
        sensorServiceId: editing.sensorServiceId, moistureThresholdPct: editing.moistureThresholdPct ?? 60,
      };
    }
    // Default: erste Pumpe mit all ihren Ventilen, sonst einzelnes Ventil.
    const firstPump = pumps[0];
    return firstPump
      ? {
          mode: "pump" as const, deviceId: firstPump.id,
          valveOrder: zones.filter((z) => z.pumpDeviceId === firstPump.id).map((z) => z.id),
          startTime: "06:00", durationMinutes: 15, daysOfWeek: 127,
          isActive: true, skipOnRain: true, smartRain: false, sensorServiceId: null, moistureThresholdPct: 60,
        }
      : {
          mode: "single" as const, deviceId: zones[0]?.id ?? 0, valveOrder: [],
          startTime: "06:00", durationMinutes: 15, daysOfWeek: 127,
          isActive: true, skipOnRain: true, smartRain: false, sensorServiceId: null, moistureThresholdPct: 60,
        };
  });
  const [saving, setSaving] = useState(false);

  const toggleDay = (i: number) => setForm((f) => ({ ...f, daysOfWeek: f.daysOfWeek ^ (1 << i) }));

  const selectTarget = (value: string) => {
    if (value === "single") {
      const firstValve = zones.find((z) => !pumps.some((p) => p.id === z.id));
      setForm((f) => ({ ...f, mode: "single", deviceId: firstValve?.id ?? zones[0]?.id ?? 0, valveOrder: [] }));
    } else {
      const pumpId = Number(value.slice(2));
      setForm((f) => ({ ...f, mode: "pump", deviceId: pumpId, valveOrder: valvesOfPump(pumpId) }));
    }
  };

  const toggleValve = (id: number) =>
    setForm((f) => ({
      ...f,
      valveOrder: f.valveOrder.includes(id) ? f.valveOrder.filter((x) => x !== id) : [...f.valveOrder, id],
    }));

  const moveValve = (id: number, dir: -1 | 1) =>
    setForm((f) => {
      const idx = f.valveOrder.indexOf(id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= f.valveOrder.length) return f;
      const next = [...f.valveOrder];
      [next[idx], next[to]] = [next[to], next[idx]];
      return { ...f, valveOrder: next };
    });

  const pumpValves = form.mode === "pump" ? zones.filter((z) => z.pumpDeviceId === form.deviceId) : [];
  // Anzeige: ausgewaehlte Ventile in Reihenfolge, danach die abgewaehlten.
  const orderedValves = [
    ...form.valveOrder.map((id) => pumpValves.find((z) => z.id === id)).filter((z): z is Zone => !!z),
    ...pumpValves.filter((z) => !form.valveOrder.includes(z.id)),
  ];
  const singleZones = zones.filter((z) => !pumps.some((p) => p.id === z.id));
  const totalMinutes = form.mode === "pump" ? form.valveOrder.length * form.durationMinutes : form.durationMinutes;
  const canSave = form.mode === "pump" ? form.valveOrder.length > 0 : !!form.deviceId;

  const submit = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Zeitplan bearbeiten" : "Neuer Zeitplan"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* 1. Pumpe / Ziel */}
          <div className="space-y-1.5">
            <Label>Pumpe</Label>
            <Select
              value={form.mode === "pump" ? `p:${form.deviceId}` : "single"}
              onValueChange={selectTarget}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Pumpe wählen" /></SelectTrigger>
              <SelectContent>
                {pumps.map((p) => (
                  <SelectItem key={p.id} value={`p:${p.id}`}>{p.name}</SelectItem>
                ))}
                <SelectItem value="single">Einzelnes Ventil (ohne Sequenz)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.mode === "single" && (
            <div className="space-y-1.5">
              <Label>Ventil</Label>
              <Select value={String(form.deviceId)} onValueChange={(v) => setForm((f) => ({ ...f, deviceId: Number(v) }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Ventil wählen" /></SelectTrigger>
                <SelectContent>
                  {(singleZones.length > 0 ? singleZones : zones).map((z) => (
                    <SelectItem key={z.id} value={String(z.id)}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 2. Zeit + Dauer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Startzeit</Label>
              <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{form.mode === "pump" ? "Dauer je Ventil (Min)" : "Dauer (Min)"}</Label>
              <Input type="number" min={1} max={180} value={form.durationMinutes}
                onChange={(e) => setForm((f) => ({ ...f, durationMinutes: Math.max(1, Math.min(180, Number(e.target.value) || 1)) }))} />
            </div>
          </div>

          {/* 3. Ventil-Reihenfolge */}
          {form.mode === "pump" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Reihenfolge der Ventile</Label>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {form.valveOrder.length} Ventile · gesamt ca. {totalMinutes} Min
                </span>
              </div>
              {pumpValves.length === 0 ? (
                <EmptyState
                  compact
                  icon={Droplet}
                  title="Dieser Pumpe sind noch keine Ventile zugeordnet."
                  description="Ordne Ventile in der Zonen-Ansicht der Pumpe zu."
                  className="glass-tile"
                />
              ) : (
                <div className="glass-tile divide-y divide-border overflow-hidden">
                  {orderedValves.map((z) => {
                    const pos = form.valveOrder.indexOf(z.id);
                    const selected = pos >= 0;
                    return (
                      <div key={z.id} className={cn("flex items-center gap-2 px-3 py-2", !selected && "opacity-50")}>
                        {/* Wie das Kästchen (Checkbox), zeigt aber die Position in der Sequenz; die
                            unsichtbare Fläche (after:) vergrößert das Tippziel auf 44 px. */}
                        <button
                          type="button"
                          onClick={() => toggleValve(z.id)}
                          aria-pressed={selected}
                          className={cn(
                            "relative size-5 rounded-[6px] border flex items-center justify-center shrink-0 text-[10px] font-bold tabular-nums outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 after:absolute after:-inset-3 after:content-['']",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-foreground/35 bg-field text-transparent hover:border-foreground/55 dark:border-white/30",
                          )}
                          title={selected ? "Aus Sequenz entfernen" : "Zur Sequenz hinzufügen"}
                        >
                          {selected ? pos + 1 : "+"}
                        </button>
                        <span className="text-sm text-foreground truncate flex-1">{z.name}</span>
                        {selected && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => moveValve(z.id, -1)}
                              disabled={pos === 0}
                              className="text-muted-foreground hover:text-foreground max-sm:size-11"
                              title="Früher"
                              aria-label="Früher"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => moveValve(z.id, 1)}
                              disabled={pos === form.valveOrder.length - 1}
                              className="text-muted-foreground hover:text-foreground max-sm:size-11"
                              title="Später"
                              aria-label="Später"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Die Ventile laufen nacheinander (je {form.durationMinutes} Min) – die Pumpe schaltet automatisch mit.
                {form.smartRain && " Mit Wasserbilanz + Zonen-Daten (L/h, m²) wird die Dauer je Ventil automatisch berechnet."}
              </p>
            </div>
          )}

          {/* 4. Wochentage */}
          <div className="space-y-1.5">
            <Label>Wochentage</Label>
            <div className="flex gap-1">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  title={DAY_LABELS_LONG[i]}
                  aria-pressed={((form.daysOfWeek >> i) & 1) === 1}
                  className={cn(
                    "press flex-1 h-9 max-sm:h-11 rounded-control text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    (form.daysOfWeek >> i) & 1
                      ? "bg-primary text-primary-foreground"
                      : "bg-foreground/[0.06] text-muted-foreground hover:text-foreground dark:bg-white/[0.08] dark:text-foreground/80 dark:hover:text-foreground",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Smart-Regen */}
          <div className="glass-tile p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CloudRain className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Bei Regen aussetzen</p>
                  <p className="text-xs text-muted-foreground">Überspringt den Lauf bei deutlicher Regenprognose</p>
                </div>
              </div>
              <Switch aria-label="Bei Regen aussetzen" checked={form.skipOnRain} onCheckedChange={(v) => setForm((f) => ({ ...f, skipOnRain: v }))} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Wasserbilanz (Dauer berechnen)</p>
                  <p className="text-xs text-muted-foreground">
                    Dauer aus Verdunstung (ET₀) minus gefallenem Regen seit dem letzten Lauf.
                    Mit L/h + m² an der Zone wird sie je Ventil exakt berechnet.
                  </p>
                </div>
              </div>
              <Switch aria-label="Wasserbilanz (Dauer berechnen)" checked={form.smartRain} onCheckedChange={(v) => setForm((f) => ({ ...f, smartRain: v }))} />
            </div>
          </div>

          {/* 6. Bodenfeuchte-Sensor */}
          <div className="glass-tile p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Sprout className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Smart-Feuchtigkeit (Sensor)</p>
                <p className="text-xs text-muted-foreground">Setzt bei feuchtem Boden aus, passt die Dauer smart an</p>
              </div>
            </div>
            <Select
              value={form.sensorServiceId ?? "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, sensorServiceId: v === "none" ? null : v }))}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Sensor wählen" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Kein Sensor</SelectItem>
                {form.sensorServiceId && !sensors.some((s) => s.serviceId === form.sensorServiceId) && (
                  <SelectItem value={form.sensorServiceId}>Zugeordneter Sensor (offline)</SelectItem>
                )}
                {sensors.map((s) => (
                  <SelectItem key={s.serviceId} value={s.serviceId}>
                    {sensorOptionLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.sensorServiceId && (() => {
              const sel = sensors.find((s) => s.serviceId === form.sensorServiceId);
              if (!sel) return null;
              const age = fmtSensorAge(sel.soilHumidityAt);
              return (
                <div className="rounded-control bg-glass-tile px-3 py-2 text-xs text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1.5">
                    <Sprout className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    Bodenfeuchte: <strong className="tabular-nums">{sel.soilHumidity != null ? `${Math.round(sel.soilHumidity)} %` : "—"}</strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Battery className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    Akku: <strong className="tabular-nums">{sel.batteryLevel != null ? `${Math.round(sel.batteryLevel)} %` : "—"}</strong>
                  </span>
                  {sel.soilTemperature != null && (
                    <span className="flex items-center gap-1.5">
                      <Thermometer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      Boden: <strong className="tabular-nums">{Math.round(sel.soilTemperature)} °C</strong>
                    </span>
                  )}
                  {age && (
                    <span className="text-muted-foreground col-span-2">Letzte Messung {age}</span>
                  )}
                </div>
              );
            })()}
            {form.sensorServiceId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="moisture-threshold">Aussetzen ab Bodenfeuchte</Label>
                  <span className="text-xs font-semibold tabular-nums text-foreground/80">{form.moistureThresholdPct} %</span>
                </div>
                {/* System-Regler (globals.css, touch-slider): großer Daumen, gefüllte Schiene bis zum Wert. */}
                <input
                  id="moisture-threshold"
                  type="range"
                  min={5}
                  max={95}
                  step={5}
                  value={form.moistureThresholdPct}
                  onChange={(e) => setForm((f) => ({ ...f, moistureThresholdPct: Number(e.target.value) }))}
                  style={{ "--slider-fill": `${((form.moistureThresholdPct - 5) / 90) * 100}%` } as React.CSSProperties}
                  className="touch-slider w-full"
                />
                <p className="text-[11px] text-muted-foreground">
                  Feuchter als {form.moistureThresholdPct} % → Lauf wird übersprungen. Fast so feucht → halbe Dauer, sehr trocken → 25 % länger.
                </p>
              </div>
            )}
            {sensors.length === 0 && !form.sensorServiceId && (
              <p className="text-[11px] text-muted-foreground">Kein GARDENA-Sensor gefunden. Sensoren erscheinen hier automatisch, sobald sie im GARDENA-Konto eingebunden sind.</p>
            )}
          </div>

          <div className="glass-tile flex items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Aktiv</p>
            </div>
            <Switch aria-label="Aktiv" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={submit} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? "Speichern" : "Erstellen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

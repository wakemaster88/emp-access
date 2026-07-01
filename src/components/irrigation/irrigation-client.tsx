"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Droplets, Droplet, CloudRain, Sun, Thermometer, Battery, BatteryLow,
  Wifi, WifiOff, Play, Square, Sparkles, Plus, Pencil, Trash2, Clock,
  CalendarDays, Gauge, Loader2, RefreshCw, CircleAlert, Sprout, CheckCircle2,
  Check, X, Activity, Timer, Waves, ChevronUp, ChevronDown,
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
  soilTemperature: number | null;
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

// ── Konstanten / Helfer ────────────────────────────────────────────────────────

const ASSUMED_FLOW_L_PER_MIN = 12;
const DURATION_PRESETS = [5, 10, 15, 20, 30, 45, 60] as const;
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

function fmtNext(when: Date): string {
  const now = new Date();
  const sameDay = when.toDateString() === now.toDateString();
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  const isTmr = when.toDateString() === tmr.toDateString();
  const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `Heute ${time}`;
  if (isTmr) return `Morgen ${time}`;
  return `${DAY_LABELS[(when.getDay() + 6) % 7]} ${time}`;
}

const LEVEL_STYLES: Record<IrrigationLevel, { badge: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  skip: { badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300", label: "Aussetzen", icon: CloudRain },
  reduced: { badge: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300", label: "Reduziert", icon: Droplet },
  normal: { badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", label: "Normal", icon: Droplets },
  increased: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", label: "Mehr", icon: Sun },
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

  // Smart-Run (sequenzielle Komplett-Bewässerung)
  const [baseMinutes, setBaseMinutes] = useState(15);
  const [run, setRun] = useState<SmartRun | null>(null);
  const runToken = useRef<{ cancel: boolean } | null>(null);

  // Zeitplan-Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);

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
  const fetchStatuses = useCallback(async () => {
    if (controllableIds.length === 0) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/devices/gardena-statuses?ids=${controllableIds.join(",")}`);
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
    const t = setInterval(fetchStatuses, 30_000);
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
      setTimeout(fetchStatuses, 3000);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyZone((b) => ({ ...b, [zone.id]: false }));
    }
  }, [durations, sendAction, flash, fetchStatuses]);

  const stopZone = useCallback(async (zone: Zone) => {
    setBusyZone((b) => ({ ...b, [zone.id]: true }));
    try {
      await sendAction(zone.id, "deactivate");
      setStatuses((s) => ({ ...s, [zone.id]: { ...(s[zone.id] ?? emptyStatus(zone.id)), watering: false, activity: "CLOSED" } }));
      flash("ok", `${zone.name}: gestoppt.`);
      setTimeout(fetchStatuses, 3000);
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
    fetchStatuses();
    flash(cancelled ? "err" : "ok", cancelled ? "Smart-Bewässerung gestoppt." : "Smart-Bewässerung abgeschlossen.");
  }, [zoneList, statuses, baseMinutes, recommendation, sendAction, flash, fetchStatuses, pumpIdSet]);

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
  const runScheduleNow = useCallback(async (s: Schedule) => {
    setBusySchedule((b) => ({ ...b, [s.id]: true }));
    try {
      const res = await fetch(`/api/irrigation/schedules/${s.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Start fehlgeschlagen");
      if (data.skipped) {
        flash("ok", `${s.deviceName}: nicht gestartet – ${data.skipped}`);
      } else {
        flash("ok", s.valveSequence?.length
          ? `${s.deviceName}: Sequenz mit ${s.valveSequence.length} Ventilen gestartet.`
          : `${s.deviceName}: ${s.durationMinutes} Min gestartet.`);
      }
      setTimeout(fetchStatuses, 3000);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Start fehlgeschlagen.");
    } finally {
      setBusySchedule((b) => ({ ...b, [s.id]: false }));
    }
  }, [flash, fetchStatuses]);

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
      setTimeout(fetchStatuses, 3000);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Stopp fehlgeschlagen.");
    } finally {
      setBusySchedule((b) => ({ ...b, [s.id]: false }));
    }
  }, [flash, fetchStatuses]);

  // ── Abgeleitete Werte ────────────────────────────────────────────────────────
  const wateringCount = controllableIds.filter((id) => statuses[id]?.watering).length;
  const activeSchedules = schedules.filter((s) => s.isActive).length;
  const weeklyLiters = useMemo(
    () => schedules.filter((s) => s.isActive).reduce((sum, s) => sum + bitCount(s.daysOfWeek) * s.durationMinutes * ASSUMED_FLOW_L_PER_MIN, 0),
    [schedules],
  );
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

  // Per-Pumpe Live-Kennzahlen (Durchfluss aus aktiven zugeordneten Ventilen).
  const pumpStats = useMemo(() => pumps.map((p) => {
    const valves = zoneList.filter((z) => z.pumpDeviceId === p.id && !pumpIdSet.has(z.id));
    const wateringValves = valves.filter((z) => statuses[z.id]?.watering);
    const selfWatering = statuses[p.id]?.watering ?? false;
    const running = wateringValves.length > 0 || selfWatering;
    const consumerCount = wateringValves.length > 0 ? wateringValves.length : (running ? 1 : 0);
    const flowLpm = running ? consumerCount * ASSUMED_FLOW_L_PER_MIN : 0;
    return { pumpId: p.id, valves, running, consumerCount, flowLpm };
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
          s.liters += st.flowLpm / 60; // pro Sekunde
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
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800 max-w-2xl">
          <CardContent className="pt-8 pb-8 flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-400 to-emerald-500 flex items-center justify-center">
              <Sprout className="h-7 w-7 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {connected ? "Noch keine Bewässerungs-Zonen" : "GARDENA nicht verbunden"}
              </h2>
              <p className="text-sm text-slate-500 mt-1 max-w-md">
                {connected
                  ? "Importiere deine GARDENA-Ventile und Pumpen, um sie hier als Zonen zu steuern."
                  : "Verbinde dein GARDENA smart system und importiere die Ventile/Pumpen, um die smarte Bewässerung zu nutzen."}
              </p>
            </div>
            <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Link href="/settings">Zu den Einstellungen</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const LevelIcon = LEVEL_STYLES[recommendation.level].icon;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      {/* Banner */}
      {banner && (
        <div className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm border",
          banner.type === "ok"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40"
            : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/40",
        )}>
          {banner.type === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}
          {banner.msg}
        </div>
      )}

      {/* Wetter + Empfehlung */}
      <Card className="overflow-hidden border-slate-200 dark:border-slate-800">
        <div className="bg-gradient-to-br from-sky-500 via-sky-600 to-emerald-600 p-5 sm:p-6 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                <LevelIcon className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-white/80">Smarte Empfehlung</span>
                  <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/20")}>
                    {LEVEL_STYLES[recommendation.level].label}
                  </span>
                </div>
                <p className="text-base sm:text-lg font-medium mt-1 max-w-xl">{recommendation.reason}</p>
              </div>
            </div>
            {weather && (
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5" title="Aktuelle Temperatur">
                  <Thermometer className="h-4 w-4 text-white/80" />
                  <span className="font-semibold">{weather.currentTemp != null ? `${Math.round(weather.currentTemp)}°` : "—"}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Höchsttemperatur heute">
                  <Sun className="h-4 w-4 text-white/80" />
                  <span className="font-semibold">{weather.tempMaxToday != null ? `${Math.round(weather.tempMaxToday)}°` : "—"}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Regen heute">
                  <CloudRain className="h-4 w-4 text-white/80" />
                  <span className="font-semibold">
                    {weather.precipProbToday != null ? `${Math.round(weather.precipProbToday)}%` : "—"}
                    {weather.precipSumToday != null && weather.precipSumToday > 0 ? ` · ${weather.precipSumToday.toFixed(1)}mm` : ""}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Smart-Run-Leiste */}
        <CardContent className="pt-4 pb-4">
          {run ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                  Zone {run.index + 1}/{run.total}: <span className="text-sky-700 dark:text-sky-300">{run.zoneName}</span>
                  <span className="text-slate-400">·</span>
                  <span className="tabular-nums">{fmtCountdown(run.remainingSec)}</span>
                </div>
                <Button size="sm" variant="destructive" onClick={stopSmartRun}>
                  <Square className="h-4 w-4 mr-1.5" /> Alles stoppen
                </Button>
              </div>
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${((run.index + (1 - run.remainingSec / (run.minutes * 60))) / run.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Smart-Bewässerung starten</p>
                  <p className="text-xs text-slate-500">
                    Alle Zonen nacheinander · {recommendedMinutes(baseMinutes, recommendation) || baseMinutes} Min/Zone
                    {!recommendation.shouldWater && " · heute laut Wetter nicht nötig"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-slate-500">Basis</Label>
                  <Select value={String(baseMinutes)} onValueChange={(v) => setBaseMinutes(Number(v))}>
                    <SelectTrigger size="sm" className="w-[92px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DURATION_PRESETS.map((d) => <SelectItem key={d} value={String(d)}>{d} Min</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={startSmartRun} className="bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-700 hover:to-emerald-700 text-white">
                  <Play className="h-4 w-4 mr-1.5" /> Starten
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistik */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Droplets} label="Ventile" value={`${zoneList.length - pumps.length}`} hint={`${pumps.length} Pumpe${pumps.length === 1 ? "" : "n"} · ${wateringCount} aktiv`} accent="text-sky-600" />
        <StatCard icon={CalendarDays} label="Aktive Zeitpläne" value={`${activeSchedules}`} hint={`${schedules.length} gesamt`} accent="text-emerald-600" />
        <StatCard icon={Gauge} label="Verbrauch / Woche" value={`${(weeklyLiters / 1000).toFixed(weeklyLiters >= 1000 ? 1 : 0)}${weeklyLiters >= 1000 ? " m³" : " L"}`} hint="geschätzt" accent="text-teal-600" />
        <StatCard icon={Clock} label="Nächste Bewässerung" value={nextRun ? fmtNext(nextRun.when) : "—"} hint={nextRun?.label ?? "kein Zeitplan"} accent="text-indigo-600" />
      </div>

      {/* Zonen nach Pumpe gruppiert */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Droplets className="h-4 w-4" /> Bewässerung
          </h2>
          <Button variant="ghost" size="sm" onClick={fetchStatuses} disabled={statusLoading} className="text-slate-500">
            <RefreshCw className={cn("h-4 w-4 mr-1.5", statusLoading && "animate-spin")} /> Aktualisieren
          </Button>
        </div>

        <div className="space-y-5">
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
                flowLpm={st?.flowLpm ?? 0}
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
                  <p className="text-sm text-slate-400 col-span-full py-2">
                    Noch keine Ventile zugeordnet – wähle in einer Ventil-Karte unten diese Pumpe aus.
                  </p>
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
                    />
                  ))
                )}
              </PumpGroup>
            );
          })}

          {unassignedValves.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-3">
                <Droplet className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Ohne Pumpe</h3>
                <span className="text-xs text-slate-400">{unassignedValves.length} Ventil{unassignedValves.length === 1 ? "" : "e"}</span>
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
                  />
                ))}
              </div>
            </div>
          )}

          {pumps.length === 0 && unassignedValves.length === 0 && (
            <p className="text-sm text-slate-400">Keine Zonen vorhanden.</p>
          )}
        </div>
      </div>

      {/* Zeitpläne */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Zeitpläne
          </h2>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="h-4 w-4 mr-1.5" /> Neuer Zeitplan
          </Button>
        </div>
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
            {schedules.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                Noch keine Zeitpläne. Lege einen an, damit die Bewässerung automatisch (wetterabhängig) läuft.
              </div>
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
                  onDelete={() => deleteSchedule(s.id)}
                />
              ))
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
          <CircleAlert className="h-3.5 w-3.5" />
          Zeitpläne werden serverseitig automatisch ausgeführt (alle 5 Min geprüft). „Bei Regen aussetzen“ nutzt die Wetterprognose.
        </p>
      </div>

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
    </div>
  );
}

function emptyStatus(id: number): ZoneStatus {
  return { id, online: true, activity: null, watering: false, batteryLevel: null, batteryState: null, modelType: null, source: "cloud" };
}

// ── Statistik-Karte ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, hint, accent }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint: string; accent: string;
}) {
  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-slate-500">
          <Icon className={cn("h-4 w-4", accent)} />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1.5 truncate">{value}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate">{hint}</p>
      </CardContent>
    </Card>
  );
}

// ── Pumpen-Gruppe (Pumpe + zugeordnete Ventile) ──────────────────────────────

function PumpGroup({
  pump, pumpStatus, running, flowLpm, elapsed, liters, consumerCount, valveCount,
  duration, busy, disabled, onDuration, onStart, onStop, onRename, children,
}: {
  pump: Zone; pumpStatus?: ZoneStatus; running: boolean; flowLpm: number; elapsed: number;
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
    <section className={cn(
      "rounded-xl border overflow-hidden transition-shadow",
      running ? "border-sky-300 dark:border-sky-800 ring-1 ring-sky-400/40" : "border-slate-200 dark:border-slate-800",
    )}>
      {/* Pumpen-Kopf */}
      <div className="bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              running ? "bg-sky-100 dark:bg-sky-900/40" : "bg-slate-100 dark:bg-slate-800",
            )}>
              <Activity className={cn("h-5 w-5", running ? "text-sky-600 animate-pulse" : "text-slate-400")} />
            </div>
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
                    className="h-7 py-1 text-sm"
                  />
                  <button onClick={commitRename} className="text-emerald-600 hover:text-emerald-700 shrink-0" title="Speichern">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setEditing(false); setDraft(pump.name); }} className="text-slate-400 hover:text-slate-600 shrink-0" title="Abbrechen">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="group/pname flex items-center gap-1.5">
                  <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{pump.name}</p>
                  <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
                    <Activity className="h-3 w-3" /> Pumpe
                  </Badge>
                  <button
                    onClick={() => { setDraft(pump.name); setEditing(true); }}
                    className="opacity-0 group-hover/pname:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 shrink-0"
                    title="Umbenennen"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <p className="text-xs text-slate-400 mt-0.5">
                {running ? `${consumerCount} von ${valveCount} Ventil${valveCount === 1 ? "" : "en"} aktiv` : `${valveCount} Ventil${valveCount === 1 ? "" : "e"}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {online != null && (
              online ? (
                <Badge variant="outline" className="text-[10px] gap-1 border-emerald-200 text-emerald-600 dark:border-emerald-900/50">
                  <Wifi className="h-3 w-3" /> Online
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] gap-1 border-slate-200 text-slate-400">
                  <WifiOff className="h-3 w-3" /> Offline
                </Badge>
              )
            )}
            {battery != null && (
              <span className={cn("text-[10px] flex items-center gap-0.5", battery <= 20 ? "text-rose-500" : "text-slate-400")}>
                {battery <= 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />} {battery}%
              </span>
            )}
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
              running
                ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
            )}>
              {running ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-slate-400" />
              )}
              {running ? "Läuft" : "Aus"}
            </span>
          </div>
        </div>

        {/* Live-Kennzahlen */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <PumpMetric icon={Waves} accent="text-sky-600" label="Durchfluss" value={running ? `${flowLpm}` : "0"} unit="L/min" />
          <PumpMetric icon={Timer} accent="text-indigo-600" label="Laufzeit" value={fmtCountdown(elapsed)} unit="min" />
          <PumpMetric icon={Droplet} accent="text-teal-600" label="Durchlauf" value={fmtLiters(liters)} unit="" />
          <PumpMetric icon={Droplets} accent="text-emerald-600" label="Aktive Ventile" value={`${consumerCount}`} unit={`/ ${valveCount}`} />
        </div>

        {/* Fluss-Animation */}
        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          {running && (
            <div
              className="h-full w-full animate-pump-flow"
              style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(56,189,248,0.9) 0, rgba(56,189,248,0.9) 8px, rgba(16,185,129,0.7) 8px, rgba(16,185,129,0.7) 16px)" }}
            />
          )}
        </div>

        {/* Manuelle Pumpen-Steuerung */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {DURATION_PRESETS.map((d) => (
              <button
                key={d}
                onClick={() => onDuration(d)}
                disabled={disabled || watering}
                className={cn(
                  "px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
                  duration === d
                    ? "bg-sky-600 text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700",
                )}
              >
                {d}′
              </button>
            ))}
          </div>
          {watering ? (
            <Button onClick={onStop} disabled={busy || disabled} variant="destructive" size="sm" className="ml-auto">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Square className="h-4 w-4 mr-1.5" /> Pumpe stoppen</>}
            </Button>
          ) : (
            <Button onClick={onStart} disabled={busy || disabled || !pump.serviceId} size="sm" className="ml-auto bg-sky-600 hover:bg-sky-700 text-white">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Play className="h-4 w-4 mr-1.5" /> {duration} Min laufen</>}
            </Button>
          )}
        </div>
      </div>

      {/* Zugeordnete Ventile */}
      <div className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Zugeordnete Ventile</p>
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
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon className={cn("h-3.5 w-3.5", accent)} />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums truncate">
        {value}{unit && <span className="text-xs font-medium text-slate-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

// ── Zonen-Karte ──────────────────────────────────────────────────────────────

// Klare An/Aus-Anzeige des Ventils.
function ZoneStateBadge({ status }: { status?: ZoneStatus }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium";

  if (!status || status.source === "unavailable") {
    return (
      <span className={cn(base, "bg-slate-100 dark:bg-slate-800 text-slate-400")}>
        <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
        Status unbekannt
      </span>
    );
  }

  if (status.watering) {
    const label = status.activity === "SCHEDULED_WATERING" ? "An · Zeitplan" : "An · bewässert";
    return (
      <span className={cn(base, "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300")}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
        </span>
        {label}
      </span>
    );
  }

  if (status.activity === "PAUSED") {
    return (
      <span className={cn(base, "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300")}>
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Pausiert
      </span>
    );
  }

  return (
    <span className={cn(base, "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400")}>
      <span className="h-2 w-2 rounded-full bg-slate-400" />
      Aus · geschlossen
    </span>
  );
}

function ZoneCard({ zone, status, duration, recommended, busy, disabled, isPump, pumpOptions, onDuration, onStart, onStop, onRename, onAssignPump }: {
  zone: Zone; status?: ZoneStatus; duration: number; recommended: number; busy: boolean; disabled: boolean;
  isPump: boolean; pumpOptions: Zone[];
  onDuration: (m: number) => void; onStart: () => void; onStop: () => void; onRename: (name: string) => void;
  onAssignPump: (pumpId: number | null) => void;
}) {
  const watering = status?.watering ?? false;
  const online = status?.online ?? false;
  const battery = status?.batteryLevel ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(zone.name);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== zone.name) onRename(draft.trim());
    else setDraft(zone.name);
  };

  return (
    <Card className={cn(
      "border-slate-200 dark:border-slate-800 transition-shadow",
      watering && "ring-2 ring-sky-400/60 dark:ring-sky-500/50",
    )}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              watering ? "bg-sky-100 dark:bg-sky-900/40" : "bg-slate-100 dark:bg-slate-800",
            )}>
              <Droplets className={cn("h-5 w-5", watering ? "text-sky-600 animate-pulse" : "text-slate-400")} />
            </div>
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
                    className="h-7 py-1 text-sm"
                  />
                  <button onClick={commitRename} className="text-emerald-600 hover:text-emerald-700 shrink-0" title="Speichern">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setEditing(false); setDraft(zone.name); }} className="text-slate-400 hover:text-slate-600 shrink-0" title="Abbrechen">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="group/name flex items-center gap-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{zone.name}</p>
                  {isPump && (
                    <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
                      <Activity className="h-3 w-3" /> Pumpe
                    </Badge>
                  )}
                  <button
                    onClick={() => { setDraft(zone.name); setEditing(true); }}
                    className="opacity-0 group-hover/name:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 shrink-0"
                    title="Umbenennen"
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
              <Badge variant="outline" className="text-[10px] gap-1 border-emerald-200 text-emerald-600 dark:border-emerald-900/50">
                <Wifi className="h-3 w-3" /> Online
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] gap-1 border-slate-200 text-slate-400">
                <WifiOff className="h-3 w-3" /> Offline
              </Badge>
            )}
            {battery != null && (
              <span className={cn("text-[10px] flex items-center gap-0.5", battery <= 20 ? "text-rose-500" : "text-slate-400")}>
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
              className={cn(
                "px-2 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
                duration === d
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700",
              )}
            >
              {d}′
            </button>
          ))}
          {recommended > 0 && recommended !== duration && (
            <button
              onClick={() => onDuration(recommended)}
              disabled={disabled || watering}
              className="px-2 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50 flex items-center gap-1"
              title="Wetter-Empfehlung übernehmen"
            >
              <Sparkles className="h-3 w-3" /> {recommended}′
            </button>
          )}
        </div>

        {/* Pumpen-Zuordnung (nur fuer Ventile, nicht fuer die Pumpe selbst) */}
        {!isPump && pumpOptions.length > 0 && (
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <Select
              value={zone.pumpDeviceId ? String(zone.pumpDeviceId) : "none"}
              onValueChange={(v) => onAssignPump(v === "none" ? null : Number(v))}
              disabled={disabled}
            >
              <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
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
            <Button onClick={onStop} disabled={busy || disabled} variant="destructive" className="flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Square className="h-4 w-4 mr-1.5" /> Stopp</>}
            </Button>
          ) : (
            <Button onClick={onStart} disabled={busy || disabled || !zone.serviceId} className="flex-1 bg-sky-600 hover:bg-sky-700 text-white">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Play className="h-4 w-4 mr-1.5" /> {duration} Min bewässern</>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
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
      "flex items-center gap-3 p-3 sm:p-4 transition-colors",
      running && "bg-sky-50/60 dark:bg-sky-950/20",
    )}>
      <div className="flex flex-col items-center gap-1 shrink-0">
        <Switch checked={schedule.isActive} onCheckedChange={onToggle} title={schedule.isActive ? "Aktiv – klicken zum Pausieren" : "Pausiert – klicken zum Aktivieren"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("font-medium truncate", schedule.isActive ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500")}>
            {schedule.deviceName}
          </span>
          {running ? (
            <Badge className="text-[10px] gap-1 bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border-transparent">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
              </span>
              Läuft
            </Badge>
          ) : schedule.isActive ? (
            <Badge variant="outline" className="text-[10px] gap-1 text-emerald-600 border-emerald-200 dark:border-emerald-900/50">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Aktiv
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] gap-1 text-slate-400 border-slate-200 dark:border-slate-700">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Pausiert
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
            <Badge variant="outline" className="text-[10px] gap-1 text-sky-600 border-sky-200 dark:border-sky-900/50">
              <CloudRain className="h-3 w-3" /> Regen-Stopp
            </Badge>
          )}
          {schedule.smartRain && (
            <Badge variant="outline" className="text-[10px] gap-1 text-indigo-600 border-indigo-200 dark:border-indigo-900/50">
              <Sparkles className="h-3 w-3" /> Smart-Regen
            </Badge>
          )}
          {schedule.sensorServiceId && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] gap-1",
                moistEnough
                  ? "text-emerald-600 border-emerald-200 dark:border-emerald-900/50"
                  : "text-amber-600 border-amber-200 dark:border-amber-900/50",
              )}
              title={sensor
                ? `${sensor.name}: Bodenfeuchte ${humidity != null ? `${Math.round(humidity)} %` : "unbekannt"} · Schwelle ${threshold} % (aussetzen ab Schwelle)`
                : "Sensor derzeit nicht erreichbar"}
            >
              <Sprout className="h-3 w-3" />
              {humidity != null ? `${Math.round(humidity)} %` : "—"} / {threshold} %
              {moistEnough && " · setzt aus"}
            </Badge>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          {fmtDays(schedule.daysOfWeek)}
          {sequenceNames.length > 0 && <> · {sequenceNames.join(" → ")}</>}
          {schedule.lastRunAt && <> · Zuletzt: {fmtLastRun(schedule.lastRunAt)}</>}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {running ? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/50" onClick={onStop} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Square className="h-3.5 w-3.5" /> Stopp</>}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sky-600 border-sky-200 hover:bg-sky-50 dark:border-sky-900/50" onClick={onRunNow} disabled={busy} title="Zeitplan jetzt ausführen">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Play className="h-3.5 w-3.5" /> Jetzt</>}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-600" onClick={onDelete}>
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
                <span className="text-[11px] text-slate-400">
                  {form.valveOrder.length} Ventile · gesamt ca. {totalMinutes} Min
                </span>
              </div>
              {pumpValves.length === 0 ? (
                <p className="text-xs text-slate-400 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-3">
                  Dieser Pumpe sind noch keine Ventile zugeordnet. Ordne Ventile in der Zonen-Ansicht der Pumpe zu.
                </p>
              ) : (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                  {orderedValves.map((z) => {
                    const pos = form.valveOrder.indexOf(z.id);
                    const selected = pos >= 0;
                    return (
                      <div key={z.id} className={cn("flex items-center gap-2 px-3 py-2", !selected && "opacity-50")}>
                        <button
                          type="button"
                          onClick={() => toggleValve(z.id)}
                          className={cn(
                            "h-5 w-5 rounded-md border flex items-center justify-center shrink-0 text-[10px] font-bold transition-colors",
                            selected
                              ? "bg-sky-600 border-sky-600 text-white"
                              : "border-slate-300 dark:border-slate-600 text-transparent hover:border-sky-400",
                          )}
                          title={selected ? "Aus Sequenz entfernen" : "Zur Sequenz hinzufügen"}
                        >
                          {selected ? pos + 1 : "+"}
                        </button>
                        <span className="text-sm text-slate-900 dark:text-slate-100 truncate flex-1">{z.name}</span>
                        {selected && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveValve(z.id, -1)}
                              disabled={pos === 0}
                              className="h-6 w-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30"
                              title="Früher"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveValve(z.id, 1)}
                              disabled={pos === form.valveOrder.length - 1}
                              className="h-6 w-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30"
                              title="Später"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-slate-400">
                Die Ventile laufen nacheinander (je {form.durationMinutes} Min) – die Pumpe schaltet automatisch mit.
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
                  className={cn(
                    "flex-1 py-2 rounded-md text-xs font-medium transition-colors",
                    (form.daysOfWeek >> i) & 1
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Smart-Regen */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CloudRain className="h-4 w-4 text-sky-600" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Bei Regen aussetzen</p>
                  <p className="text-xs text-slate-400">Überspringt den Lauf bei deutlicher Regenprognose</p>
                </div>
              </div>
              <Switch checked={form.skipOnRain} onCheckedChange={(v) => setForm((f) => ({ ...f, skipOnRain: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Smart-Regen (Dauer anpassen)</p>
                  <p className="text-xs text-slate-400">Heiß → länger, Regenrisiko/kühl → kürzer</p>
                </div>
              </div>
              <Switch checked={form.smartRain} onCheckedChange={(v) => setForm((f) => ({ ...f, smartRain: v }))} />
            </div>
          </div>

          {/* 6. Bodenfeuchte-Sensor */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Sprout className="h-4 w-4 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Smart-Feuchtigkeit (Sensor)</p>
                <p className="text-xs text-slate-400">Setzt bei feuchtem Boden aus, passt die Dauer smart an</p>
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
                    {s.name}{s.soilHumidity != null ? ` · ${Math.round(s.soilHumidity)} %` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.sensorServiceId && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Aussetzen ab Bodenfeuchte</Label>
                  <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{form.moistureThresholdPct} %</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={95}
                  step={5}
                  value={form.moistureThresholdPct}
                  onChange={(e) => setForm((f) => ({ ...f, moistureThresholdPct: Number(e.target.value) }))}
                  className="w-full accent-emerald-600"
                />
                <p className="text-[11px] text-slate-400">
                  Feuchter als {form.moistureThresholdPct} % → Lauf wird übersprungen. Fast so feucht → halbe Dauer, sehr trocken → 25 % länger.
                </p>
              </div>
            )}
            {sensors.length === 0 && !form.sensorServiceId && (
              <p className="text-[11px] text-slate-400">Kein GARDENA-Sensor gefunden. Sensoren erscheinen hier automatisch, sobald sie im GARDENA-Konto eingebunden sind.</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Aktiv</p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={submit} disabled={saving || !canSave} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? "Speichern" : "Erstellen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

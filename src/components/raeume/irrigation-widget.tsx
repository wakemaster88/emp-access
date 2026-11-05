"use client";

/**
 * Bewässerung in der Raumkarte (Mockup W18): der Zeitplan mit Pumpe und
 * Ventilreihenfolge, wie er unter „Bewässerung“ gepflegt wird, hier nur
 * gezeigt und gestartet. Zustände: läuft (Schritte mit Fortschritt, Stopp),
 * wartet (nächster Lauf, Empfehlung, Bodenfeuchte, „Jetzt bewässern“),
 * ausgesetzt (Regen, „Trotzdem“), Störung (Ventil offline, Sensor-Batterie)
 * und der Verbrauch der letzten sieben Tage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudRain, Droplets, Loader2, Play, Square, Sun, TriangleAlert } from "lucide-react";
import { DeviceRow } from "@/components/raeume/device-row";
import type { DeviceStatus } from "@/components/raeume/status";
import type { RoomDevice } from "@/components/raeume/types";
import type { IrrigationLevel } from "@/lib/irrigation";
import {
  fmtLiters,
  fmtNextRun,
  fmtRemainingSec,
  litersFor,
  runProgress,
  stepState,
  type RoomIrrigation,
  type RoomIrrigationSchedule,
} from "@/lib/room-irrigation";
import { weekdayBitOfYmd } from "@/lib/tz-time";
import { cn } from "@/lib/utils";

/** Antwort von GET /api/devices/gardena-statuses. */
interface ValveStatus {
  id: number;
  online: boolean;
  watering: boolean;
  source: "cloud" | "unavailable";
}

/** Antwort von GET /api/irrigation/sensors. */
interface SoilSensor {
  serviceId: string;
  name: string;
  soilHumidity: number | null;
  batteryLevel: number | null;
  online: boolean;
}

/** GARDENA hat ein hartes Wochen-Kontingent; nicht öfter als alle 5 Minuten. */
const POLL_MS = 300_000;
const DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const LEVEL_LABEL: Record<IrrigationLevel, string> = {
  skip: "Aussetzen",
  reduced: "Weniger",
  normal: "Normal",
  increased: "Mehr",
};

export function IrrigationWidget({
  irrigation,
  devices,
  statuses,
  nowMs,
  timezone,
  readonly,
  roomName,
  onAction,
}: {
  irrigation: RoomIrrigation;
  /** Die Ventil-Geräte des Raums, für Einzelsteuerung ohne Zeitplan. */
  devices: RoomDevice[];
  statuses: Map<number, DeviceStatus>;
  nowMs: number;
  timezone: string;
  readonly: boolean;
  roomName: string;
  onAction: (device: RoomDevice, action: string) => Promise<string | null>;
}) {
  const router = useRouter();
  const [valveStatus, setValveStatus] = useState<Record<number, ValveStatus>>({});
  const [sensors, setSensors] = useState<SoilSensor[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const valveIds = useMemo(() => irrigation.valves.filter((v) => v.isActive).map((v) => v.id), [irrigation.valves]);
  const wantsSensors = irrigation.schedules.some((s) => s.sensorServiceId);

  const loadStatuses = useCallback(
    async (fresh = false) => {
      if (valveIds.length === 0) return;
      try {
        const res = await fetch(`/api/devices/gardena-statuses?ids=${valveIds.join(",")}${fresh ? "&fresh=1" : ""}`);
        if (!res.ok) return;
        const data = (await res.json()) as ValveStatus[];
        setValveStatus(Object.fromEntries(data.map((d) => [d.id, d])));
      } catch {
        /* Anzeige bleibt beim letzten Stand */
      }
    },
    [valveIds],
  );

  useEffect(() => {
    void loadStatuses();
    const t = setInterval(() => void loadStatuses(), POLL_MS);
    return () => clearInterval(t);
  }, [loadStatuses]);

  useEffect(() => {
    if (!wantsSensors) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/irrigation/sensors");
        if (res.ok && !cancelled) setSensors((await res.json()) as SoilSensor[]);
      } catch {
        /* ohne Sensor-Wert weiter */
      }
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [wantsSensors]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6_000);
    return () => clearTimeout(t);
  }, [message]);

  async function act(schedule: RoomIrrigationSchedule, action: "start" | "stop", force = false) {
    if (readonly || busy) return;
    setBusy(schedule.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/irrigation/schedules/${schedule.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, force }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; skipped?: string };
      if (!res.ok) setMessage({ tone: "err", text: data.error ?? "Aktion fehlgeschlagen" });
      else if (data.skipped) setMessage({ tone: "ok", text: data.skipped });
      else setMessage({ tone: "ok", text: action === "start" ? "Bewässerung gestartet" : "Bewässerung gestoppt" });
      router.refresh();
      // Die Cloud braucht einen Moment, bis das Ventil den neuen Zustand meldet.
      setTimeout(() => void loadStatuses(true), 4_000);
    } finally {
      setBusy(null);
    }
  }

  // ── Welcher Zeitplan steht vorn? Laufend vor wartend vor pausiert. ──
  const running = irrigation.schedules.find((s) => s.run && !runProgress(s.run, irrigation.valves, nowMs).finished) ?? null;
  const upcoming = irrigation.schedules
    .filter((s) => s.nextRunAt)
    .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!));
  const primary = running ?? upcoming[0] ?? irrigation.schedules[0] ?? null;
  const scheduledValveIds = new Set(irrigation.schedules.flatMap((s) => s.valveIds ?? [s.deviceId]));
  const looseValves = devices.filter((d) => !scheduledValveIds.has(d.id));
  const wateringLoose = looseValves.filter((d) => valveStatus[d.id]?.watering);

  const offlineValves = irrigation.valves.filter((v) => v.isActive && valveStatus[v.id]?.online === false);
  const sensor = primary?.sensorServiceId ? sensors.find((s) => s.serviceId === primary.sensorServiceId) ?? null : null;
  const weakSensor = sensors.find((s) => s.batteryLevel != null && s.batteryLevel < 20) ?? null;

  const weekLiters = irrigation.days.reduce((sum, d) => sum + d.liters, 0);
  const maxDay = Math.max(1, ...irrigation.days.map((d) => d.liters));
  const now = new Date(nowMs);

  return (
    <div className="space-y-2">
      {running ? (
        <RunningCard schedule={running} irrigation={irrigation} nowMs={nowMs} busy={busy === running.id} readonly={readonly} onStop={() => void act(running, "stop")} />
      ) : primary ? (
        <WaitingCard
          schedule={primary}
          irrigation={irrigation}
          sensor={sensor}
          now={now}
          timezone={timezone}
          busy={busy === primary.id}
          readonly={readonly}
          onStart={(force) => void act(primary, "start", force)}
        />
      ) : (
        <div className="glass-tile rounded-tile p-3 text-[12px] text-muted-foreground">
          <span className="block font-semibold text-foreground">Noch kein Zeitplan</span>
          {irrigation.valves.length === 1 ? "Ein Ventil" : `${irrigation.valves.length} Ventile`} im Raum, aber keine Bewässerungszeit.
          {!readonly && (
            <>
              {" "}
              <Link href="/bewaesserung" className="font-medium text-primary hover:underline">
                Zeitplan anlegen
              </Link>
            </>
          )}
        </div>
      )}

      {message && (
        <p className={cn("px-1 text-[11px]", message.tone === "err" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>{message.text}</p>
      )}

      {(offlineValves.length > 0 || weakSensor) && (
        <div className="space-y-1 rounded-tile border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px]">
          {offlineValves.map((v) => (
            <p key={v.id} className="flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="h-3 w-3 shrink-0" />
              <span className="font-semibold">{v.name} antwortet nicht</span>
              <span className="text-destructive/80">· GARDENA meldet offline</span>
            </p>
          ))}
          {weakSensor && (
            <p className="flex items-center gap-1.5 text-warning">
              <TriangleAlert className="h-3 w-3 shrink-0" />
              <span className="font-semibold">{weakSensor.name}</span>
              <span>· Batterie {Math.round(weakSensor.batteryLevel!)} %, tauschen</span>
            </p>
          )}
        </div>
      )}

      {looseValves.length > 0 && (
        <div className="space-y-1.5">
          {irrigation.schedules.length > 0 && (
            <p className="px-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Ohne Zeitplan{wateringLoose.length > 0 ? ` · ${wateringLoose.length} läuft` : ""}
            </p>
          )}
          {looseValves.map((d) => (
            <DeviceRow key={d.id} device={d} roomName={roomName} status={statuses.get(d.id)} nowMs={nowMs} readonly={readonly} onAction={onAction} />
          ))}
        </div>
      )}

      {irrigation.days.some((d) => d.runs > 0) && (
        <div className="glass-tile rounded-tile p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Verbrauch · 7 Tage</span>
            <span className="text-sm font-semibold tabular-nums tracking-tight">{fmtLiters(weekLiters)}</span>
          </div>
          <div className="mt-2 flex h-14 items-end gap-1.5">
            {irrigation.days.map((d, i) => {
              const today = i === irrigation.days.length - 1;
              return (
                <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.date}: ${fmtLiters(d.liters)} · ${d.runs} ${d.runs === 1 ? "Lauf" : "Läufe"}`}>
                  <div className="flex h-10 w-full items-end">
                    <div
                      className={cn("w-full rounded-t-[4px]", d.liters > 0 ? (today ? "bg-sky-500" : "bg-sky-500/55") : "bg-foreground/10")}
                      style={{ height: d.liters > 0 ? `${Math.max(8, (d.liters / maxDay) * 100)}%` : "2px" }}
                    />
                  </div>
                  <span className={cn("text-[10px] tabular-nums", today ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {DAY_SHORT[weekdayBitOfYmd(d.date)]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RunningCard({
  schedule,
  irrigation,
  nowMs,
  busy,
  readonly,
  onStop,
}: {
  schedule: RoomIrrigationSchedule;
  irrigation: RoomIrrigation;
  nowMs: number;
  busy: boolean;
  readonly: boolean;
  onStop: () => void;
}) {
  const run = schedule.run!;
  const p = runProgress(run, irrigation.valves, nowMs);
  const step = p.current != null ? run.steps[p.current] : null;
  const factor = schedule.smartRain && irrigation.recommendation ? irrigation.recommendation.factor : 1;
  return (
    <div className="rounded-tile border border-sky-400/35 bg-gradient-to-b from-sky-500/12 to-transparent p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white shadow-[0_6px_14px_-6px_rgba(14,165,233,0.8)]">
          <Droplets className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">
            Bewässerung läuft <span className="font-normal text-muted-foreground">· {schedule.name}</span>
          </p>
          <p className="text-[11px] text-sky-700 dark:text-sky-300">
            {step ? `${step.name} · ${p.done + 1} von ${p.total} · ${fmtRemainingSec(p.remainingSec)}` : `${p.done} von ${p.total} fertig`}
            {p.litersSoFar > 0 && <span className="text-muted-foreground"> · bisher {fmtLiters(p.litersSoFar)}</span>}
          </p>
        </div>
        {!readonly && (
          <button
            type="button"
            onClick={onStop}
            disabled={busy}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-foreground px-3 text-[11px] font-semibold text-background disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            Stopp
          </button>
        )}
      </div>
      <ol className="mt-2.5 space-y-1">
        {run.steps.map((s, i) => {
          const state = stepState(s, nowMs);
          const start = s.startedAt ? Date.parse(s.startedAt) : 0;
          const elapsedMin = state === "running" ? Math.min(s.minutes, (nowMs - start) / 60_000) : 0;
          return (
            <li key={`${s.deviceId}-${i}`} className="flex items-center gap-2 rounded-control bg-background/50 px-2.5 py-1.5 text-[11px] dark:bg-foreground/5">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  state === "done" ? "bg-emerald-500" : state === "running" ? "bg-sky-500 animate-pulse" : "bg-foreground/20",
                )}
              />
              <span className={cn("min-w-0 flex-1 truncate", state === "waiting" ? "text-muted-foreground" : "font-medium text-foreground")}>{s.name}</span>
              {state === "running" && (
                <span className="h-1 w-16 overflow-hidden rounded-full bg-sky-500/20">
                  <span className="block h-full rounded-full bg-sky-500" style={{ width: `${(elapsedMin / s.minutes) * 100}%` }} />
                </span>
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {state === "done" ? `fertig · ${s.minutes} Min` : state === "running" ? `${Math.floor(elapsedMin)} / ${s.minutes} Min` : `wartet · ${s.minutes} Min`}
              </span>
            </li>
          );
        })}
      </ol>
      {factor !== 1 && (
        <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">
          Smart ×{factor.toLocaleString("de-DE", { maximumFractionDigits: 2 })} · {irrigation.recommendation?.reason}
        </p>
      )}
    </div>
  );
}

function WaitingCard({
  schedule,
  irrigation,
  sensor,
  now,
  timezone,
  busy,
  readonly,
  onStart,
}: {
  schedule: RoomIrrigationSchedule;
  irrigation: RoomIrrigation;
  sensor: { soilHumidity: number | null } | null;
  now: Date;
  timezone: string;
  busy: boolean;
  readonly: boolean;
  onStart: (force: boolean) => void;
}) {
  const rec = irrigation.recommendation;
  const weather = irrigation.weather;
  const valveIds = schedule.valveIds ?? [schedule.deviceId];
  const valveById = new Map(irrigation.valves.map((v) => [v.id, v]));
  const factor = schedule.smartRain && rec ? rec.factor : 1;
  const moisture = sensor?.soilHumidity ?? null;
  const moistSkip = moisture != null && schedule.moistureThresholdPct != null && moisture >= schedule.moistureThresholdPct;
  const rainSkip = schedule.skipOnRain && rec?.level === "skip";
  const skipped = schedule.isActive && (rainSkip || moistSkip);
  const next = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
  const minutes = Math.max(0, Math.round(schedule.durationMinutes * (skipped ? 1 : factor)));
  const liters = valveIds.reduce((sum, id) => sum + litersFor(minutes, valveById.get(id)), 0);
  const weatherLine = weather
    ? [
        weather.tempMaxToday != null ? `${Math.round(weather.tempMaxToday)} °C` : null,
        (weather.precipSumToday ?? 0) >= 1
          ? `${Math.round(weather.precipSumToday!)} mm Regen${weather.precipProbToday != null ? ` (${Math.round(weather.precipProbToday)} %)` : ""}`
          : "kein Regen",
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  const title = !schedule.isActive
    ? "Zeitplan pausiert"
    : skipped
      ? "Heute ausgesetzt"
      : next
        ? `Nächste Bewässerung ${fmtNextRun(next, now, timezone)}`
        : "Kein nächster Lauf";
  const sub = !schedule.isActive
    ? `${schedule.name} · unter „Bewässerung“ wieder einschalten`
    : skipped
      ? `${rainSkip ? "Regen erwartet" : "Boden feucht genug"}${weatherLine && rainSkip ? ` · ${weatherLine}` : ""}${next ? ` · nächster Lauf ${fmtNextRun(next, now, timezone)}` : ""}`
      : `${valveIds.length === 1 ? valveById.get(valveIds[0])?.name ?? "1 Ventil" : `${valveIds.length} Ventile`} · ${schedule.durationMinutes} Min${factor !== 1 ? ` × ${factor.toLocaleString("de-DE", { maximumFractionDigits: 2 })}` : ""} · ca. ${fmtLiters(liters)}`;

  return (
    <div className={cn("rounded-tile border p-3", skipped ? "border-sky-400/25 bg-sky-500/5" : "glass-tile")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", skipped ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "bg-muted text-muted-foreground")}>
          {skipped && rainSkip ? <CloudRain className="h-4 w-4" /> : <Droplets className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">{title}</p>
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        </div>
        {!readonly && schedule.isActive && (
          <button
            type="button"
            onClick={() => onStart(skipped)}
            disabled={busy}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[11px] font-semibold disabled:opacity-60",
              skipped ? "border border-border bg-background/60 text-foreground" : "bg-primary-fill text-primary-foreground",
            )}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {skipped ? "Trotzdem" : "Jetzt bewässern"}
          </button>
        )}
      </div>

      {(rec || moisture != null) && (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {rec && (
            <div className="rounded-control bg-background/50 px-2.5 py-2 dark:bg-foreground/5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Empfehlung</p>
              <p className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold">
                {rec.level === "skip" ? <CloudRain className="h-3.5 w-3.5 text-sky-500" /> : rec.level === "increased" ? <Sun className="h-3.5 w-3.5 text-amber-500" /> : <Droplets className="h-3.5 w-3.5 text-sky-500" />}
                {LEVEL_LABEL[rec.level]}
              </p>
              {weatherLine && <p className="truncate text-[11px] text-muted-foreground">{weatherLine}</p>}
            </div>
          )}
          {moisture != null && (
            <div className="rounded-control bg-background/50 px-2.5 py-2 dark:bg-foreground/5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Bodenfeuchte</p>
              <p className="mt-0.5 text-[12px] font-semibold tabular-nums">{Math.round(moisture)} %</p>
              <div className="relative mt-1 h-1.5 overflow-visible rounded-full bg-foreground/10">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, Math.max(0, moisture))}%` }} />
                {schedule.moistureThresholdPct != null && (
                  <span
                    className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-foreground/60"
                    style={{ left: `${Math.min(100, Math.max(0, schedule.moistureThresholdPct))}%` }}
                    title={`Schwelle ${schedule.moistureThresholdPct} %`}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Klimaverlauf eines Raums (Mockup W16): Temperatur und Luftfeuchte als zwei
 * eigene Diagramme mit einer Achse, Zeitraum Tag / Woche / Monat / Jahr.
 * Temperatur orange, Feuchte himmelblau, Sollbereich als grünes Band,
 * Jetzt-Marke gestrichelt (docs/design-regeln.md, Abschnitt 8).
 *
 * Die Daten kommen von GET /api/klima/verlauf; der Hub liefert sie alle fünf
 * Minuten (src/lib/climate-history.ts).
 */

import { useEffect, useState } from "react";
import { Area, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Droplets, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";

export type HistoryRange = "day" | "week" | "month" | "year";

export const RANGES: { key: HistoryRange; label: string }[] = [
  { key: "day", label: "Tag" },
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
  { key: "year", label: "Jahr" },
];

interface Point {
  t: number;
  tempMin: number | null;
  tempAvg: number | null;
  tempMax: number | null;
  humMin: number | null;
  humAvg: number | null;
  humMax: number | null;
  count: number;
}

interface Stats {
  tempMin: number | null;
  tempAvg: number | null;
  tempMax: number | null;
  humMin: number | null;
  humAvg: number | null;
  humMax: number | null;
}

interface Series {
  deviceId: number;
  name: string;
  points: Point[];
  last: { t: number; tempC: number | null; humidity: number | null } | null;
  stats: Stats | null;
}

interface History {
  range: HistoryRange;
  from: number;
  to: number;
  bucketMs: number;
  series: Series[];
  target: { targetC: number; hysteresisC: number } | null;
}

const TEMP = "#f97316";
const HUM = "#0ea5e9";

const fmt1 = (v: number | null | undefined, unit: string) =>
  v == null ? "–" : `${v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit}`;
const fmt0 = (v: number | null | undefined, unit: string) => (v == null ? "–" : `${Math.round(v)}${unit}`);

function tickFormatter(range: HistoryRange, tz: string) {
  const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const day = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: tz });
  const date = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: tz });
  const month = new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: tz });
  return (t: number) => {
    if (range === "day") return time.format(t);
    if (range === "week") return day.format(t);
    if (range === "month") return date.format(t);
    return month.format(t);
  };
}

function ticks(range: HistoryRange, from: number, to: number, tz: string): number[] {
  // Tagesgrenzen in der Zeitzone des Betriebs; fuer "Tag" alle drei Stunden ab der vollen Stunde.
  const step = range === "day" ? 3 * 3_600_000 : range === "week" ? 24 * 3_600_000 : range === "month" ? 5 * 24 * 3_600_000 : 30 * 24 * 3_600_000;
  const out: number[] = [];
  const offset = tzOffsetMs(from, tz);
  const first = Math.ceil((from + offset) / step) * step - offset;
  for (let t = first; t <= to; t += step) out.push(t);
  return out;
}

/** Versatz der Zeitzone zu UTC in Millisekunden zum Zeitpunkt `ms`. */
function tzOffsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

function labelFor(t: number, range: HistoryRange, tz: string): string {
  const opts: Intl.DateTimeFormatOptions =
    range === "year"
      ? { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz }
      : { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: tz };
  return new Intl.DateTimeFormat("de-DE", opts).format(t);
}

export function RangeStrip({ value, onChange, className }: { value: HistoryRange; onChange: (r: HistoryRange) => void; className?: string }) {
  return (
    <div role="tablist" aria-label="Zeitraum" className={cn("glass-strip inline-flex gap-0.5", className)}>
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          role="tab"
          aria-selected={value === r.key}
          onClick={() => onChange(r.key)}
          className={cn(
            "h-7 rounded-full px-3 text-[11px] transition-all duration-200",
            value === r.key ? "glass-pill-active font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function HistoryTooltip({
  active,
  payload,
  range,
  tz,
  kind,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  range: HistoryRange;
  tz: string;
  kind: "temp" | "hum";
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const unit = kind === "temp" ? " °C" : " %";
  const f = kind === "temp" ? fmt1 : fmt0;
  const [min, avg, max] = kind === "temp" ? [p.tempMin, p.tempAvg, p.tempMax] : [p.humMin, p.humAvg, p.humMax];
  return (
    <div className="glass-card px-3 py-2 text-[11px] shadow-lg">
      <p className="font-semibold text-foreground">{labelFor(p.t, range, tz)}</p>
      <p className="tabular-nums text-muted-foreground">
        {f(avg, unit)}
        {min != null && max != null && min !== max && <span> · {f(min, unit)} bis {f(max, unit)}</span>}
      </p>
    </div>
  );
}

function Chart({
  kind,
  points,
  from,
  to,
  range,
  tz,
  nowMs,
  target,
}: {
  kind: "temp" | "hum";
  points: Point[];
  from: number;
  to: number;
  range: HistoryRange;
  tz: string;
  nowMs: number;
  target: History["target"];
}) {
  const color = kind === "temp" ? TEMP : HUM;
  const avgKey = kind === "temp" ? "tempAvg" : "humAvg";
  const band = (p: Point) => (kind === "temp" ? [p.tempMin, p.tempMax] : [p.humMin, p.humMax]);
  const values = points.flatMap((p) => (kind === "temp" ? [p.tempMin, p.tempMax] : [p.humMin, p.humMax])).filter((v): v is number => v != null);
  if (target && kind === "temp") values.push(target.targetC - target.hysteresisC, target.targetC + target.hysteresisC);
  const lo = values.length ? Math.floor(Math.min(...values) - 1) : 0;
  const hi = values.length ? Math.ceil(Math.max(...values) + 1) : 1;
  const unit = kind === "temp" ? "°" : "%";
  return (
    <div className="h-36 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="t"
            type="number"
            domain={[from, to]}
            ticks={ticks(range, from, to, tz)}
            tickFormatter={tickFormatter(range, tz)}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            domain={[lo, hi]}
            width={30}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickFormatter={(v: number) => `${v}${unit}`}
            axisLine={false}
            tickLine={false}
            tickCount={4}
          />
          {target && kind === "temp" && (
            <ReferenceArea y1={target.targetC - target.hysteresisC} y2={target.targetC + target.hysteresisC} fill="#10b981" fillOpacity={0.12} stroke="none" />
          )}
          <Area type="monotone" dataKey={band} stroke="none" fill={color} fillOpacity={0.14} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey={avgKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} isAnimationActive={false} connectNulls />
          {nowMs >= from && nowMs <= to && <ReferenceLine x={nowMs} stroke="var(--foreground)" strokeOpacity={0.5} strokeDasharray="3 3" />}
          <Tooltip content={<HistoryTooltip range={range} tz={tz} kind={kind} />} cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.25 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

/**
 * Verlauf eines Raums. `range` kommt von außen, damit mehrere Räume auf der
 * Auswertungsseite denselben Zeitraum zeigen; `onRange` blendet die Wahl ein.
 */
export function ClimateHistory({
  roomId,
  range,
  onRange,
  timezone,
  nowMs,
}: {
  roomId: number;
  range: HistoryRange;
  onRange?: (r: HistoryRange) => void;
  timezone: string;
  nowMs: number;
}) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState("");
  // Alle fuenf Minuten neu laden, passend zum Takt des Hubs; `loading`, bis
  // die Antwort zu genau dieser Anfrage da ist.
  const key = `${roomId}:${range}:${Math.floor(nowMs / 300_000)}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== key;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/klima/verlauf?roomId=${roomId}&range=${range}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as History & { error?: string };
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (!cancelled) {
          setData(body);
          setError("");
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, range, key]);

  const series = data?.series ?? [];
  const empty = !loading && series.every((s) => s.points.length === 0);

  return (
    <div className="space-y-3">
      {onRange && <RangeStrip value={range} onChange={onRange} />}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {loading && !data && <div className="glass-tile h-36 animate-pulse" />}
      {empty && (
        <p className="glass-tile p-3 text-xs text-muted-foreground">
          Noch kein Verlauf. Der Hub liest die Fühler im LAN jede Minute und meldet alle fünf Minuten; ohne Hub schreibt die Cloud alle fünf
          Minuten einen Punkt.
        </p>
      )}
      {data &&
        series
          .filter((s) => s.points.length > 0)
          .map((s) => {
            const hasHum = s.points.some((p) => p.humAvg != null);
            return (
              <div key={s.deviceId} className="glass-tile space-y-2 p-3">
                <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
                  {series.length > 1 && <p className="w-full truncate text-[12px] font-semibold">{s.name}</p>}
                  <Stat label="Jetzt" value={fmt1(s.last?.tempC, " °C")} tone="text-orange-600 dark:text-orange-400" />
                  <Stat label="Min" value={fmt1(s.stats?.tempMin, " °C")} />
                  <Stat label="Mittel" value={fmt1(s.stats?.tempAvg, " °C")} />
                  <Stat label="Max" value={fmt1(s.stats?.tempMax, " °C")} />
                  {hasHum && (
                    <Stat label="Feuchte" value={`${fmt0(s.last?.humidity, " %")} · ${fmt0(s.stats?.humMin, "")}–${fmt0(s.stats?.humMax, " %")}`} tone="text-sky-600 dark:text-sky-400" />
                  )}
                </div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Thermometer className="h-3 w-3" /> Temperatur
                </p>
                <Chart kind="temp" points={s.points} from={data.from} to={data.to} range={range} tz={timezone} nowMs={nowMs} target={data.target} />
                {hasHum && (
                  <>
                    <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <Droplets className="h-3 w-3" /> Luftfeuchte
                    </p>
                    <Chart kind="hum" points={s.points} from={data.from} to={data.to} range={range} tz={timezone} nowMs={nowMs} target={null} />
                  </>
                )}
              </div>
            );
          })}
    </div>
  );
}

/**
 * Feste Regeln fuer Energie, Maeher und Bewaesserung (ohne Seiteneffekte,
 * damit testbar). energy.ts liefert die Daten und verschickt die Vorschlaege.
 */
import type { WeatherHour, WeatherDay } from "../weather.js";

const H = 3_600_000;
const TZ = "Europe/Berlin";

/* ------------------------------------------------------------ Zeit (Berlin) */

/** Versatz Berlin gegenueber UTC in Minuten zu einem Zeitpunkt. */
function berlinOffsetMin(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** Zeitpunkt zu Berliner Datum (YYYY-MM-DD) und Uhrzeit (HH:MM). */
export function berlinAt(date: string, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = berlinOffsetMin(new Date(guess));
  const at = new Date(guess - off * 60_000);
  // Um die Zeitumstellung herum noch einmal nachziehen.
  const off2 = berlinOffsetMin(at);
  return off2 === off ? at : new Date(guess - off2 * 60_000);
}

export function berlinDate(at: Date): string {
  return at.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** 0 = So … 6 = Sa (wie Date.getDay), in Berliner Zeit. */
export function berlinWeekday(at: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(at);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

export function hhmm(at: Date): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

const HHMM_RE = /^(\d{1,2}):(\d{2})/;

/* ------------------------------------------------------------ Wetter-Fenster */

export interface WindowWeather {
  rainMm: number;
  maxProb: number;
  minTempC: number | null;
  maxWindKmh: number;
  /** Regen in den 6 Stunden davor (nasses Gras). */
  rainBeforeMm: number;
}

export function windowWeather(hours: WeatherHour[], start: Date, end: Date): WindowWeather {
  const s = start.getTime();
  const e = end.getTime();
  let rainMm = 0;
  let maxProb = 0;
  let minTempC: number | null = null;
  let maxWindKmh = 0;
  let rainBeforeMm = 0;
  for (const h of hours) {
    const t = Date.parse(h.t);
    // Stundenwert gilt fuer die Stunde davor (Open-Meteo: Summe der Vorstunde).
    if (t > s && t <= e + H - 1) {
      rainMm += h.precipMm ?? 0;
      maxProb = Math.max(maxProb, h.precipProb ?? 0);
      if (h.tempC != null) minTempC = minTempC == null ? h.tempC : Math.min(minTempC, h.tempC);
      maxWindKmh = Math.max(maxWindKmh, h.windKmh ?? 0);
    } else if (t > s - 6 * H && t <= s) {
      rainBeforeMm += h.precipMm ?? 0;
    }
  }
  return { rainMm: round1(rainMm), maxProb, minTempC, maxWindKmh: Math.round(maxWindKmh), rainBeforeMm: round1(rainBeforeMm) };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/* ------------------------------------------------------------ Maeher */

export interface MowerTaskLite {
  mower: string;
  mowerLabel: string;
  id: string;
  name: string;
  enabled: boolean;
  startTime: string;
  endTime: string;
  /** "So", "Mo", … wie der Maeher-Dienst sie liefert. */
  weekdays: string[];
}

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
/** Ohne erkennbares Ende rechnen wir mit drei Stunden Maehen. */
const DEFAULT_MOW_H = 3;

/** Naechster Lauf einer Aufgabe ab `now` innerhalb von `withinH` Stunden. */
export function nextMowRun(task: MowerTaskLite, now: Date, withinH = 36): { start: Date; end: Date } | null {
  const m = HHMM_RE.exec(task.startTime ?? "");
  if (!task.enabled || !m || !task.weekdays.length) return null;
  const days = new Set(task.weekdays.map((w) => WD.indexOf(w)).filter((i) => i >= 0));
  const today = berlinDate(now);
  for (let off = 0; off <= 2; off++) {
    const date = addDays(today, off);
    const start = berlinAt(date, `${m[1]}:${m[2]}`);
    if (!days.has(berlinWeekday(start))) continue;
    if (start.getTime() < now.getTime() - 15 * 60_000) continue;
    if (start.getTime() - now.getTime() > withinH * H) return null;
    const em = HHMM_RE.exec(task.endTime ?? "");
    let end = em ? berlinAt(date, `${em[1]}:${em[2]}`) : new Date(start.getTime() + DEFAULT_MOW_H * H);
    if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * H);
    if (end.getTime() - start.getTime() > 10 * H) end = new Date(start.getTime() + DEFAULT_MOW_H * H);
    return { start, end };
  }
  return null;
}

export interface MowVerdict {
  ok: boolean;
  reasons: string[];
  weather: WindowWeather;
}

/** Soll eine geplante Maeh-Aufgabe laufen? Regen, nasses Gras, Kaelte, Sturm sprechen dagegen. */
export function mowVerdict(hours: WeatherHour[], start: Date, end: Date): MowVerdict {
  const w = windowWeather(hours, start, end);
  const reasons: string[] = [];
  if (w.rainMm >= 0.5) reasons.push(`${w.rainMm} mm Regen erwartet`);
  else if (w.maxProb >= 70) reasons.push(`${w.maxProb} % Regenrisiko`);
  if (w.rainBeforeMm >= 2) reasons.push(`Gras nass (${w.rainBeforeMm} mm Regen vorher)`);
  if (w.minTempC != null && w.minTempC < 3) reasons.push(`zu kalt (${Math.round(w.minTempC)} °C)`);
  if (w.maxWindKmh >= 50) reasons.push(`Sturm (${w.maxWindKmh} km/h)`);
  return { ok: reasons.length === 0, reasons, weather: w };
}

/** Regnet es gerade (letzte volle Stunde)? */
export function rainingNow(hours: WeatherHour[], now: Date): boolean {
  const t = now.getTime();
  const h = hours.find((x) => {
    const ts = Date.parse(x.t);
    return ts > t - H / 2 && ts <= t + H / 2;
  });
  return (h?.precipMm ?? 0) >= 0.3;
}

/** Trockene Zeitfenster (mind. `minH` Stunden, 8–20 Uhr) zum Maehen. */
export function dryWindows(hours: WeatherHour[], from: Date, to: Date, minH = 3): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  let runStart: number | null = null;
  let runEnd = 0;
  const flush = () => {
    if (runStart != null && runEnd - runStart >= minH * H) out.push({ start: new Date(runStart), end: new Date(runEnd) });
    runStart = null;
  };
  for (const h of hours) {
    const end = Date.parse(h.t);
    const start = end - H;
    if (start < from.getTime() || end > to.getTime()) continue;
    const hour = Number(hhmm(new Date(start)).slice(0, 2));
    const dry = (h.precipMm ?? 0) < 0.1 && (h.precipProb ?? 0) < 40 && (h.tempC ?? 10) >= 5 && (h.windKmh ?? 0) < 40;
    if (dry && hour >= 8 && hour < 20) {
      if (runStart == null) runStart = start;
      runEnd = end;
    } else flush();
  }
  flush();
  return out;
}

/* ------------------------------------------------------------ Bewaesserung */

export interface IrrigationLite {
  id: number;
  name: string;
  startTime: string;
  daysOfWeek: number;
  durationMinutes: number;
  isActive: boolean;
  skipOnRain: boolean;
  smartRain: boolean;
}

export interface IrrigationOutlook {
  id: number;
  name: string;
  at: string;
  durationMinutes: number;
  /** Was die Cloud voraussichtlich macht. */
  expect: "laeuft" | "ausgesetzt";
  hint: string | null;
}

/** Bit fuer einen Wochentag (Mo = Bit 0 … So = Bit 6). */
function irrigationBit(weekday: number): number {
  return 1 << ((weekday + 6) % 7);
}

/**
 * Bewaesserungen eines Tages mit der erwarteten Entscheidung der Cloud
 * (gleiche Schwelle wie src/lib/irrigation.ts: ≥ 4 mm oder ≥ 70 % → aussetzen)
 * und Hinweisen, wo eine Einstellung Wasser sparen wuerde.
 */
export function irrigationOutlook(plans: IrrigationLite[], day: WeatherDay | undefined, date: string): IrrigationOutlook[] {
  const wd = berlinWeekday(berlinAt(date, "12:00"));
  const rain = day?.precipMm ?? 0;
  const prob = day?.precipProb ?? 0;
  const wet = rain >= 4 || prob >= 70;
  const frost = day?.tMin != null && day.tMin <= 1;
  return plans
    .filter((p) => p.isActive && (p.daysOfWeek & irrigationBit(wd)) !== 0)
    .map((p) => {
      let expect: IrrigationOutlook["expect"] = "laeuft";
      let hint: string | null = null;
      if (wet && p.skipOnRain) expect = "ausgesetzt";
      else if (wet) hint = `läuft trotz ${Math.round(rain)} mm Regen – in der Cloud „Bei Regen aussetzen“ einschalten`;
      if (frost) hint = `Frost (${Math.round(day!.tMin!)} °C) – Bewässerung für den Winter pausieren und Leitungen entleeren`;
      return { id: p.id, name: p.name, at: p.startTime, durationMinutes: p.durationMinutes, expect, hint };
    });
}

/* ------------------------------------------------------------ Vergessene Verbraucher */

/** Geraete, die dauerhaft laufen duerfen – nie als „vergessen“ melden. */
const ALWAYS_ON = /k[üu]hl|gefrier|pumpe|server|router|switch|netz|\bnas\b|kasse|kamera|alarm|frost|aquarium|notlicht|notbeleucht|dauer|24\s*\/?\s*7|uhr\b/i;

export interface DeviceView {
  id: number;
  name: string;
  room: string;
  roomId: number;
  category: string | null;
  type: string;
  on: boolean | null;
  powerW: number | null;
  /** Betriebszeit des Raums: true offen, false zu, null kein Zeitplan. */
  roomOpen: boolean | null;
  /** Von der Cloud-Klimaregelung gesteuert (Heizung/Luefter). */
  climateManaged: boolean;
}

/** Kommt das Geraet als vergessener Verbraucher in Frage (ohne Zeitbedingung)? */
export function forgottenCandidate(d: DeviceView): boolean {
  if (d.on !== true || d.roomOpen !== false || d.climateManaged) return false;
  const latching = d.type === "HUE_LIGHT" || d.category === "BELEUCHTUNG" || d.category === "SCHALTER";
  if (!latching) return false;
  return !ALWAYS_ON.test(d.name);
}

/**
 * Seit wann ein Geraet ausserhalb der Betriebszeit an ist. Gibt die Geraete
 * zurueck, die mindestens `minMin` Minuten durchgehend so laufen.
 */
export function trackForgotten(track: Map<number, number>, devices: DeviceView[], now: number, minMin = 45): DeviceView[] {
  const seen = new Set<number>();
  const due: DeviceView[] = [];
  for (const d of devices) {
    if (!forgottenCandidate(d)) continue;
    seen.add(d.id);
    const since = track.get(d.id) ?? now;
    track.set(d.id, since);
    if (now - since >= minMin * 60_000) due.push(d);
  }
  for (const id of [...track.keys()]) if (!seen.has(id)) track.delete(id);
  return due;
}

/** Grobe Heizkosten-Schaetzung fuer den Vorschlagstext. */
export function costHint(powerW: number | null, hours: number, eurPerKwh = 0.3): string {
  if (powerW == null || powerW < 5) return "";
  const kwh = (powerW / 1000) * hours;
  return ` (${Math.round(powerW)} W, über ${hours} h ≈ ${kwh.toFixed(1)} kWh / ${(kwh * eurPerKwh).toFixed(2).replace(".", ",")} €)`;
}

/**
 * Bewachungs-Zustand je Kamera fuer Log und Tagesvorschau. Reine Logik, ohne
 * Netz und ohne Uhr.
 *
 * Bewacht ist eine Kamera, wenn der Waechter ein Ereignis an ihr bewerten
 * wuerde: dieselbe Regel wie im Takt (sentinelClosed mit der Einstellung der
 * Kamera, modeAlways, cameraWatched). Ob das Bildmodell bereit ist oder ein Chat
 * gekoppelt, steht nicht hier, sondern in der Liste fuer die Cloud
 * (sentinel-cover-rules.ts).
 *
 *  - guardState: bewacht ja/nein und warum, fuer den Augenblick.
 *  - guardChangeLines: beim Start eine Uebersicht, danach eine Zeile je
 *    Wechsel (zusammengefasst nach Richtung und Grund).
 *  - guardTodayLine: „Heute bewacht: …“ fuer die Tagesvorschau, aus den
 *    Oeffnungsspannen der Raeume (Raumdaten, heute und morgen) und dem
 *    Nachtfenster.
 */
import { cameraWatched } from "./sentinel-rules.js";
import { modeAlways, sentinelClosed, type SentinelMode } from "./sentinel-mode-rules.js";
import { inQuietHours } from "./quiet.js";
import type { RoomsClosed } from "./sentinel-rooms-rules.js";

export interface GuardCamera {
  id: number;
  name: string;
  mode: SentinelMode;
  /** Raeume der Kamera mit Betriebszeit und ob sie geschlossen sind (roomsClosed). */
  rooms: RoomsClosed;
}

export interface GuardContext {
  /** HUB_AGENT_SENTINEL=always; gilt nur fuer Kameras „wie der Raum“ (modeAlways). */
  always: boolean;
  /** Ortszeit-Stunde; NaN, wenn sie nicht lesbar ist. */
  hour: number;
  nightWindow: string;
}

export interface GuardState {
  id: number;
  name: string;
  watched: boolean;
  /** Kurzer Grund fuer das Log, z. B. „Raum Shop geschlossen“. */
  why: string;
}

const roomLabel = (names: readonly string[]) => (names.length === 1 ? `Raum ${names[0]}` : `Räume ${names.join(", ")}`);

/** Grund, wenn das Nachtfenster entscheidet. */
function nightWhy(prefix: string, ctx: GuardContext): string {
  if (!Number.isFinite(ctx.hour)) return `${prefix}Uhrzeit nicht lesbar`;
  return inQuietHours(ctx.nightWindow, ctx.hour) ? `${prefix}Nachtfenster ${ctx.nightWindow} Uhr` : `${prefix}außerhalb des Nachtfensters ${ctx.nightWindow} Uhr`;
}

/** Ist die Kamera gerade bewacht, und warum? */
export function guardState(cam: GuardCamera, ctx: GuardContext): GuardState {
  const closed = sentinelClosed(cam.mode, cam.rooms.closed, ctx.hour);
  if (closed === "aus") return { id: cam.id, name: cam.name, watched: false, why: "Wächter aus" };
  const always = modeAlways(cam.mode, ctx.always);
  const watched = cameraWatched({ always, closed, hour: ctx.hour, nightWindow: ctx.nightWindow });
  let why: string;
  if (always) why = "rund um die Uhr";
  else if (cam.mode === "nachts") why = nightWhy("nur nachts, ", ctx);
  else if (!cam.rooms.rooms.length) why = nightWhy("ohne Betriebszeit, ", ctx);
  else if (closed === true) why = `${roomLabel(cam.rooms.rooms)} geschlossen` + (cam.rooms.stale ? " (Raumdaten veraltet)" : "");
  else if (closed === false) {
    why = (cam.rooms.rooms.length === 1 ? `Raum ${cam.rooms.rooms[0]}` : `einer der Räume ${cam.rooms.rooms.join(", ")}`) + " offen";
    if (cam.rooms.stale) why += " (Raumdaten veraltet)";
  } else why = nightWhy("Raumdaten veraltet, ", ctx);
  return { id: cam.id, name: cam.name, watched, why };
}

/** Kameras nach Grund zusammenfassen: „A, B (Grund); C (Grund)“. */
function grouped(states: readonly GuardState[]): string {
  const byWhy = new Map<string, string[]>();
  for (const s of states) byWhy.set(s.why, [...(byWhy.get(s.why) ?? []), s.name]);
  return [...byWhy].map(([why, names]) => `${names.join(", ")} (${why})`).join("; ");
}

/**
 * Log-Zeilen zum Bewachungs-Zustand: beim Start (`prev` = null) je eine Zeile
 * fuer bewachte und nicht bewachte Kameras, danach eine Zeile je Richtung des
 * Wechsels mit allen Kameras, die gerade wechseln. Eine neue Kamera zaehlt
 * als Wechsel, eine entfernte schreibt nichts. `next` ist der Stand fuer den
 * naechsten Aufruf.
 */
export function guardChangeLines(
  prev: ReadonlyMap<number, boolean> | null,
  states: readonly GuardState[]
): { lines: string[]; next: Map<number, boolean> } {
  const next = new Map(states.map((s) => [s.id, s.watched]));
  const lines: string[] = [];
  if (prev === null) {
    const on = states.filter((s) => s.watched);
    const off = states.filter((s) => !s.watched);
    if (on.length) lines.push(`Wächter: beim Start bewacht: ${grouped(on)}`);
    if (off.length) lines.push(`Wächter: beim Start nicht bewacht: ${grouped(off)}`);
    return { lines, next };
  }
  const changed = states.filter((s) => prev.get(s.id) !== s.watched);
  const on = changed.filter((s) => s.watched);
  const off = changed.filter((s) => !s.watched);
  if (on.length) lines.push(`Wächter: Bewachung an: ${grouped(on)}`);
  if (off.length) lines.push(`Wächter: Bewachung aus: ${grouped(off)}`);
  return { lines, next };
}

// ---------------------------------------------------------------------------
// Tagesvorschau

/** Minuten eines Tages: [von, bis), 0 bis 1440. */
export type MinuteSpan = [number, number];

const DAY_MIN = 1440;

let clockFormat: Intl.DateTimeFormat | null = null;

/** Datum (YYYY-MM-DD) und Minute des Tages in Europe/Berlin; null, wenn unlesbar. */
export function berlinClock(ms: number): { ymd: string; min: number } | null {
  if (!Number.isFinite(ms)) return null;
  clockFormat ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(clockFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const h = Number(p.hour);
  const m = Number(p.minute);
  if (!p.year || !p.month || !p.day || !Number.isInteger(h) || !Number.isInteger(m)) return null;
  return { ymd: `${p.year}-${p.month}-${p.day}`, min: h * 60 + m };
}

/** Tag nach `ymd` (YYYY-MM-DD). */
export function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Eine Oeffnungsspanne (ISO) als Minuten von `today`; null, wenn sie den Tag nicht beruehrt. */
export function spanMinutes(span: { from: string; to: string }, today: string): MinuteSpan | null {
  const from = berlinClock(Date.parse(span.from));
  const to = berlinClock(Date.parse(span.to));
  if (!from || !to) return null;
  if (from.ymd > today || to.ymd < today) return null;
  const a = from.ymd < today ? 0 : from.min;
  const b = to.ymd > today ? DAY_MIN : to.min;
  return b > a ? [a, b] : null;
}

/** Nachtfenster "22-6" als Minuten des Tages; ungueltig oder leer = keine. */
export function nightSpans(spec: string): MinuteSpan[] {
  const m = spec.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return [];
  const from = Math.min(Number(m[1]), 24) * 60;
  const to = Math.min(Number(m[2]), 24) * 60;
  if (from === to) return [];
  return from < to ? [[from, to]] : ([[0, to], [from, DAY_MIN]] as MinuteSpan[]).filter(([a, b]) => b > a);
}

/** Vereinigung, sortiert und zusammengelegt. */
function union(spans: readonly MinuteSpan[]): MinuteSpan[] {
  const sorted = [...spans].sort((x, y) => x[0] - y[0]);
  const out: MinuteSpan[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Was vom Tag uebrig bleibt, wenn man `open` abzieht. */
export function complement(open: readonly MinuteSpan[]): MinuteSpan[] {
  const out: MinuteSpan[] = [];
  let t = 0;
  for (const [a, b] of union(open)) {
    if (a > t) out.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < DAY_MIN) out.push([t, DAY_MIN]);
  return out;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** „ganztägig“, „bis 06:00 und ab 22:00“, „10:00–18:00“. */
export function spansText(spans: readonly MinuteSpan[]): string {
  return spans
    .map(([a, b]) => (a <= 0 && b >= DAY_MIN ? "ganztägig" : a <= 0 ? `bis ${hhmm(b)}` : b >= DAY_MIN ? `ab ${hhmm(a)}` : `${hhmm(a)}–${hhmm(b)}`))
    .join(" und ");
}

export interface TodayRoom {
  name: string;
  /** Oeffnungsspannen (ISO) aus den Raumdaten; fehlt bei einer aelteren Cloud. */
  spans?: readonly { from: string; to: string }[] | null;
}

export interface TodayCamera {
  id: number;
  name: string;
  mode: SentinelMode;
  /** Raeume der Kamera mit Betriebszeit. */
  rooms: readonly TodayRoom[];
  /** Jetzt bewacht (guardState): gilt, wenn die Oeffnungszeiten von heute fehlen. */
  watchedNow: boolean;
}

export interface TodayInput {
  /** Der Waechter mit Bildern ist eingeschaltet. */
  enabled: boolean;
  /** Das Bildmodell ist nicht abgeschaltet (HUB_AGENT_VISION). */
  visionEnabled: boolean;
  /** HUB_AGENT_SENTINEL=always; gilt nur fuer Kameras „wie der Raum“ (modeAlways). */
  always: boolean;
  nightWindow: string;
  /** Heutiges Datum in Europe/Berlin (YYYY-MM-DD). */
  today: string;
  /** Tag (Europe/Berlin), an dem die Raumdaten abgerufen wurden: Ihre Spannen gelten fuer ihn und den Folgetag. null = kein Stand. */
  roomsDay: string | null;
  cams: readonly TodayCamera[];
}

/** Bewachte Zeit einer Kamera heute; `label` fasst Kameras mit gleicher Quelle zusammen. */
type TodayPlan = { guarded: true; label: string; text: string } | { guarded: false; why: string };

function planCamera(c: TodayCamera, i: TodayInput, roomsCoverToday: boolean): TodayPlan {
  if (c.mode === "aus") return { guarded: false, why: "Wächter aus" };
  if (modeAlways(c.mode, i.always)) return { guarded: true, label: "rund um die Uhr", text: "" };
  if (c.mode === "nachts" || !c.rooms.length) {
    const night = nightSpans(i.nightWindow);
    return night.length ? { guarded: true, label: "nachts", text: spansText(night) } : { guarded: false, why: "kein Nachtfenster" };
  }
  const label = c.rooms.map((r) => r.name).join("/");
  if (!roomsCoverToday || c.rooms.some((r) => !Array.isArray(r.spans))) {
    return c.watchedNow
      ? { guarded: true, label, text: "jetzt, Öffnungszeiten von heute fehlen" }
      : { guarded: false, why: `${label}: Öffnungszeiten von heute fehlen, jetzt nicht bewacht` };
  }
  const open: MinuteSpan[] = [];
  for (const r of c.rooms) {
    for (const s of r.spans ?? []) {
      const m = spanMinutes(s, i.today);
      if (m) open.push(m);
    }
  }
  const closed = complement(open);
  return closed.length ? { guarded: true, label, text: spansText(closed) } : { guarded: false, why: `${label} ganztägig offen` };
}

/**
 * Zeile fuer die Tagesvorschau, z. B. „Heute bewacht: Strandbad ganztägig
 * (Eingang); Shop bis 10:00 und ab 18:00 (Kasse); nachts bis 06:00 und ab
 * 22:00 (Lager). Nicht bewacht: Büro (Wächter aus).“ Fuer Raeume gilt die
 * Zeit ausserhalb ihrer Oeffnungsspannen von heute; fehlen diese (aeltere
 * Cloud oder Raumdaten nicht von heute oder gestern), steht der Zustand von
 * jetzt da.
 */
export function guardTodayLine(i: TodayInput): string {
  if (!i.enabled) return "Heute bewacht: nichts, der Wächter mit Bildern ist aus.";
  if (!i.visionEnabled) return "Heute bewacht: nichts, das Bildmodell ist abgeschaltet.";
  if (!i.cams.length) return "Heute bewacht: keine Kamera eingerichtet.";
  const roomsCoverToday = i.roomsDay !== null && (i.roomsDay === i.today || nextYmd(i.roomsDay) === i.today);
  const on = new Map<string, string[]>();
  const off = new Map<string, string[]>();
  for (const c of i.cams) {
    const p = planCamera(c, i, roomsCoverToday);
    const key = p.guarded ? (p.text ? `${p.label} ${p.text}` : p.label) : p.why;
    const into = p.guarded ? on : off;
    into.set(key, [...(into.get(key) ?? []), c.name]);
  }
  const head = on.size ? `Heute bewacht: ${[...on].map(([when, names]) => `${when} (${names.join(", ")})`).join("; ")}.` : "Heute bewacht: keine Kamera.";
  return off.size ? `${head} Nicht bewacht: ${[...off].map(([why, names]) => `${names.join(", ")} (${why})`).join("; ")}.` : head;
}

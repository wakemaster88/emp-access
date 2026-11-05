/**
 * Belegung und Wartezeiten an Uebungslift, Seilbahn, Gastro und Drehkreuz.
 *
 * Tagsueber (HUB_OCCUPANCY_HOURS, Standard 9-21) alle
 * HUB_OCCUPANCY_INTERVAL Sekunden (Standard 300):
 *  - Schnappschuss jeder zugeordneten Kamera, Personen zaehlen mit dem
 *    YOLO-Tracker (POST /classify), optional nur in einer Zone je Kamera.
 *  - Zutritte je Drehkreuz-Bereich aus der Cloud (GET /api/hub/occupancy):
 *    Eintritte der letzten Stunde = gemessener Durchsatz.
 *  - Wartezeit ≈ Personen / Durchsatz, Stufe nach Schwelle „voll“.
 *  - Zweimal hintereinander voll (oder Wartezeit ueber Schwelle): Meldung
 *    per Telegram mit Bild, „entspannt“, wenn es wieder leerer ist.
 *
 * Schwellen und Zonen lassen sich in hub/occupancy.json anpassen (siehe
 * occupancy-rules.ts, mergeSpots). Bilder werden nicht gespeichert, nur
 * Zahlen (Tagesspitzen in hub/.cache/occupancy.json).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, api, log } from "./config.js";
import { captureSnapshot, listCameraConfigs, listCameraStatus } from "./cameras.js";
import { detectPersons } from "./person-crop.js";
import { inside } from "./vision.js";
import { sendPhoto, sendText } from "./agent/telegram.js";
import { berlinHour } from "./agent/watch.js";
import {
  DEFAULT_SPOTS,
  camerasForSpot,
  effectivePerHour,
  inHours,
  levelFor,
  mergeSpots,
  newAlertState,
  safeRegex,
  smooth,
  spotLine,
  stepAlert,
  waitMinutes,
  type AlertState,
  type Level,
  type SpotConfig,
} from "./occupancy-rules.js";

const INTERVAL_MS = (Number(process.env.HUB_OCCUPANCY_INTERVAL) > 0 ? Number(process.env.HUB_OCCUPANCY_INTERVAL) : 300) * 1000;
const HOURS = (process.env.HUB_OCCUPANCY_HOURS ?? "9-21").trim();
const ALERTS = !/^(0|false|off|nein)$/i.test((process.env.HUB_OCCUPANCY_ALERTS ?? "1").trim());
/** Juengere Messung als das reicht fuer „Wie voll ist es?“, sonst wird neu gemessen. */
const FRESH_MS = 4 * 60_000;
const HISTORY_MS = 3 * 60 * 60_000;

export interface AreaRate {
  id: number;
  name: string;
  personLimit: number | null;
  in15: number;
  in60: number;
  inToday: number;
  out60: number | null;
  inside: number | null;
  denied15: number;
  lastScanAt: string | null;
}

export interface CameraCount {
  id: number;
  name: string;
  persons: number | null;
  error?: string;
}

export interface SpotReading {
  key: string;
  name: string;
  at: string;
  /** Personen (geglaettet: Median der letzten drei Messungen). */
  persons: number;
  /** Personen dieser einen Messung. */
  raw: number;
  full: number;
  level: Level;
  waitMin: number;
  perHour: number;
  perHourMeasured: boolean;
  cameras: CameraCount[];
  partial: boolean;
  area: { name: string; in15: number; in60: number; inToday: number; inside: number | null; personLimit: number | null } | null;
}

interface SpotRuntime {
  samples: Array<{ at: number; persons: number }>;
  alert: AlertState;
  last: SpotReading | null;
}

export const OCCUPANCY = {
  enabled: true,
  lastRunAt: null as string | null,
  lastError: null as string | null,
  alerts: 0,
};

const runtime = new Map<string, SpotRuntime>();
let spots: SpotConfig[] = DEFAULT_SPOTS;
let spotsLoadedAt = 0;
let areas: AreaRate[] = [];
let areasAt = 0;
let running: Promise<SpotReading[]> | null = null;
let peaks: Record<string, Record<string, { persons: number; waitMin: number; at: string }>> = {};

function configPath(): string {
  return process.env.HUB_OCCUPANCY_CONFIG || path.join(CONFIG.hubDir, "occupancy.json");
}

function peaksPath(): string {
  return path.join(CONFIG.hubDir, ".cache", "occupancy.json");
}

async function loadSpots(): Promise<SpotConfig[]> {
  if (Date.now() - spotsLoadedAt < 60_000) return spots;
  spotsLoadedAt = Date.now();
  try {
    spots = mergeSpots(DEFAULT_SPOTS, JSON.parse(await readFile(configPath(), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") log(`Belegung: ${configPath()} unlesbar: ${e instanceof Error ? e.message : e}`);
    spots = DEFAULT_SPOTS;
  }
  return spots;
}

/** Schwelle/Durchsatz eines Punkts dauerhaft in hub/occupancy.json setzen. */
export async function setSpotConfig(key: string, patch: Partial<Pick<SpotConfig, "full" | "perHour" | "waitAlertMin" | "enabled">>): Promise<SpotConfig> {
  let file: { spots: Array<Record<string, unknown>> } = { spots: [] };
  try {
    const raw = JSON.parse(await readFile(configPath(), "utf8"));
    file = Array.isArray(raw) ? { spots: raw } : raw && Array.isArray(raw.spots) ? raw : { spots: [] };
  } catch {
    /* neu anlegen */
  }
  const known = (await loadSpots()).find((s) => s.key === key);
  if (!known) throw new Error(`Unbekannter Punkt „${key}“. Vorhanden: ${spots.map((s) => s.key).join(", ")}`);
  let entry = file.spots.find((s) => s.key === key);
  if (!entry) file.spots.push((entry = { key }));
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) entry[k] = v;
  await writeFile(configPath(), JSON.stringify(file, null, 2) + "\n", "utf8");
  spotsLoadedAt = 0;
  return (await loadSpots()).find((s) => s.key === key)!;
}

async function loadPeaks(): Promise<void> {
  try {
    peaks = JSON.parse(await readFile(peaksPath(), "utf8"));
  } catch {
    peaks = {};
  }
}

async function savePeaks(): Promise<void> {
  const days = Object.keys(peaks).sort();
  for (const d of days.slice(0, -14)) delete peaks[d];
  await mkdir(path.dirname(peaksPath()), { recursive: true });
  await writeFile(peaksPath(), JSON.stringify(peaks), "utf8");
}

function berlinDay(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

async function refreshAreas(): Promise<void> {
  if (Date.now() - areasAt < 60_000) return;
  try {
    const res = await api("/api/hub/occupancy", { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const json = (await res.json()) as { areas?: AreaRate[] };
      areas = Array.isArray(json.areas) ? json.areas : [];
      areasAt = Date.now();
    }
  } catch {
    /* Cloud weg: Kamerazaehlung reicht */
  }
}

async function countCamera(cam: { id: number; name: string }, zone: { x: number; y: number }[] | undefined): Promise<CameraCount> {
  try {
    const jpeg = await captureSnapshot(cam.id);
    const boxes = await detectPersons(jpeg);
    if (!boxes) return { id: cam.id, name: cam.name, persons: null, error: "Tracker liefert keine Personen" };
    const n = zone ? boxes.filter((b) => inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, zone)).length : boxes.length;
    return { id: cam.id, name: cam.name, persons: n };
  } catch (e) {
    return { id: cam.id, name: cam.name, persons: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function measureSpot(spot: SpotConfig): Promise<SpotReading | null> {
  const cams = camerasForSpot(spot, listCameraConfigs());
  const areaRe = spot.area ? safeRegex(spot.area) : null;
  const area = areaRe ? areas.find((a) => areaRe.test(a.name)) ?? null : null;
  if (!cams.length && !area) return null;

  const counts: CameraCount[] = [];
  for (const c of cams) counts.push(await countCamera(c, spot.zones?.[String(c.id)]));
  const ok = counts.filter((c) => c.persons != null);
  const raw = ok.reduce((s, c) => s + (c.persons ?? 0), 0);

  const rt = runtime.get(spot.key) ?? { samples: [], alert: newAlertState(), last: null };
  runtime.set(spot.key, rt);
  const now = Date.now();
  if (ok.length) rt.samples.push({ at: now, persons: raw });
  rt.samples = rt.samples.filter((s) => now - s.at < HISTORY_MS);
  const recent = rt.samples.filter((s) => now - s.at < 3 * INTERVAL_MS + 60_000).map((s) => s.persons);
  const persons = recent.length ? smooth(recent) : 0;

  const eff = effectivePerHour(spot, area ? area.in60 : null);
  const waitMin = waitMinutes(persons, eff.perHour);
  const reading: SpotReading = {
    key: spot.key,
    name: spot.name,
    at: new Date(now).toISOString(),
    persons,
    raw,
    full: spot.full,
    level: cams.length && !ok.length ? "leer" : levelFor(persons, spot.full),
    waitMin,
    perHour: eff.perHour,
    perHourMeasured: eff.measured,
    cameras: counts,
    partial: cams.length > 0 && ok.length < cams.length,
    area: area
      ? { name: area.name, in15: area.in15, in60: area.in60, inToday: area.inToday, inside: area.inside, personLimit: area.personLimit }
      : null,
  };
  // Ganz ohne Kamerabild nichts Falsches behaupten.
  if (cams.length && !ok.length) reading.partial = true;
  rt.last = reading;
  return reading;
}

/** Alle Punkte messen (laeuft nie doppelt). */
export function measureAll(): Promise<SpotReading[]> {
  if (running) return running;
  running = (async () => {
    try {
      const list = (await loadSpots()).filter((s) => s.enabled !== false);
      await refreshAreas();
      const out: SpotReading[] = [];
      for (const s of list) {
        const r = await measureSpot(s);
        if (r) out.push(r);
      }
      OCCUPANCY.lastRunAt = new Date().toISOString();
      OCCUPANCY.lastError = null;
      const day = berlinDay();
      const today = (peaks[day] ??= {});
      let changed = false;
      for (const r of out) {
        const p = today[r.key];
        if (!p || r.persons > p.persons || r.waitMin > p.waitMin) {
          today[r.key] = {
            persons: Math.max(r.persons, p?.persons ?? 0),
            waitMin: Math.max(r.waitMin, p?.waitMin ?? 0),
            at: r.at,
          };
          changed = true;
        }
      }
      if (changed) await savePeaks().catch(() => undefined);
      return out;
    } catch (e) {
      OCCUPANCY.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

function lastReadings(): SpotReading[] {
  return [...runtime.values()].map((r) => r.last).filter((r): r is SpotReading => r != null);
}

/** Fuer das Werkzeug „occupancy“: aktuelle Lage, bei Bedarf frisch gemessen. */
export async function occupancyReport(fresh = false): Promise<unknown> {
  let readings = lastReadings();
  const newest = readings.reduce((m, r) => Math.max(m, Date.parse(r.at)), 0);
  if (fresh || !readings.length || Date.now() - newest > FRESH_MS) readings = await measureAll();
  const day = berlinDay();
  const yesterday = berlinDay(new Date(Date.now() - 24 * 3600_000));
  const reachable = new Map(listCameraStatus().map((c) => [c.id, c.reachable]));
  return {
    at: new Date().toISOString(),
    hours: HOURS,
    inOperatingHours: inHours(HOURS, berlinHour()),
    hinweis:
      "Personen = Median der letzten Messungen auf den Kamerabildern (YOLO). Wartezeit = Personen / Durchsatz pro Stunde, grob geschätzt. perHourMeasured=true: Durchsatz aus den Drehkreuz-Eintritten der letzten Stunde.",
    spots: readings.map((r) => ({
      ...r,
      summary: spotLine({ name: r.name, persons: r.persons, level: r.level, wait: r.waitMin, partial: r.partial }),
      cameras: r.cameras.map((c) => ({ ...c, reachable: reachable.get(c.id) ?? null })),
    })),
    turnstileAreas: areas.map((a) => ({ name: a.name, eintritteLetzte15min: a.in15, eintritteLetzteStunde: a.in60, eintritteHeute: a.inToday, imBereich: a.inside, limit: a.personLimit })),
    peakToday: peaks[day] ?? {},
    peakYesterday: peaks[yesterday] ?? {},
  };
}

/** Kurzlage fuer das Dashboard/den Status (ohne neue Messung). */
export function occupancySummary(): { lastRunAt: string | null; spots: Array<{ key: string; name: string; persons: number; level: Level; waitMin: number }> } {
  return {
    lastRunAt: OCCUPANCY.lastRunAt,
    spots: lastReadings().map((r) => ({ key: r.key, name: r.name, persons: r.persons, level: r.level, waitMin: r.waitMin })),
  };
}

/* ------------------------------------------------------------ Meldungen */

async function notify(chatIds: string[], reading: SpotReading, kind: "alert" | "relaxed"): Promise<void> {
  if (kind === "relaxed") {
    const text = `✅ ${reading.name} entspannt sich: ${reading.persons} Personen${reading.waitMin ? `, ca. ${reading.waitMin} min Wartezeit` : ""}.`;
    for (const id of chatIds) await sendText(id, text).catch(() => undefined);
    return;
  }
  const spot = spots.find((s) => s.key === reading.key);
  const why = reading.persons >= reading.full ? `${reading.persons} Personen (voll ab ${reading.full})` : `${reading.persons} Personen`;
  const rate = reading.perHourMeasured ? `${reading.perHour}/h laut Drehkreuz` : `${reading.perHour}/h angenommen`;
  const waitNote = spot && reading.persons < reading.full ? ` (Meldung ab ${spot.waitAlertMin} min)` : "";
  const caption = `👥 ${reading.name} wird voll: ${why}, Wartezeit ca. ${reading.waitMin} min${waitNote}. Durchsatz ${rate}.`;
  const best = [...reading.cameras].filter((c) => c.persons != null).sort((a, b) => (b.persons ?? 0) - (a.persons ?? 0))[0];
  let jpeg: Buffer | null = null;
  if (best) jpeg = await captureSnapshot(best.id).catch(() => null);
  for (const id of chatIds) {
    if (jpeg) await sendPhoto(id, jpeg, caption).catch(() => sendText(id, caption).catch(() => undefined));
    else await sendText(id, caption).catch(() => undefined);
  }
  OCCUPANCY.alerts++;
}

async function tick(chatIds: () => string[]): Promise<void> {
  if (!inHours(HOURS, berlinHour())) {
    // Ausserhalb der Betriebszeit: Meldestatus zuruecksetzen, damit der naechste Tag frisch beginnt.
    for (const rt of runtime.values()) rt.alert = newAlertState();
    return;
  }
  const readings = await measureAll();
  if (!ALERTS) return;
  const ids = chatIds();
  for (const r of readings) {
    const spot = spots.find((s) => s.key === r.key);
    const rt = runtime.get(r.key);
    if (!spot || !rt || (r.partial && r.cameras.every((c) => c.persons == null))) continue;
    const step = stepAlert(rt.alert, { persons: r.persons, full: spot.full, wait: r.waitMin, waitAlertMin: spot.waitAlertMin }, Date.now());
    if (step) {
      log(`Belegung: ${spotLine({ name: r.name, persons: r.persons, level: r.level, wait: r.waitMin })} → ${step === "alert" ? "Meldung" : "entspannt"}`);
      if (ids.length) await notify(ids, r, step);
    }
  }
}

export function startOccupancy(d: { chatIds: () => string[] }): void {
  void loadPeaks();
  log(`Belegung: an, alle ${Math.round(INTERVAL_MS / 1000)} s zwischen ${HOURS} Uhr${ALERTS ? "" : " (ohne Meldungen)"}`);
  const run = () => void tick(d.chatIds).catch((e) => log(`Belegung: ${e instanceof Error ? e.message : e}`));
  setTimeout(run, 60_000);
  setInterval(run, INTERVAL_MS);
}

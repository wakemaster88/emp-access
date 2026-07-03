/**
 * Smarte Bewässerungs-Logik: Wetter-Empfehlung, Zeitplan-Auswertung fuer den
 * Cron und Verbrauchs-Schätzung.
 *
 * Zeitpläne (`IrrigationSchedule`) steuern GARDENA-Ventile (Device mit
 * type = GARDENA_VALVE). Der Cron (`/api/cron/irrigation`) ruft `runIrrigationTick`
 * alle 5 Minuten auf.
 */

import { prisma } from "@/lib/prisma";
import { getWeather, WEATHER_PAST_DAYS, type Weather } from "@/lib/weather";
import { gardenaControlValve, gardenaListSensors } from "@/lib/gardena";
import { logIrrigationRun, type IrrigationRunSource } from "@/lib/irrigation-run-log";

// Angenommener Durchfluss pro Ventil/Zone (Liter pro Stunde), falls die Zone
// keine eigene Durchflussrate (`Device.flowLph`) gepflegt hat.
export const ASSUMED_FLOW_L_PER_HOUR = 720;

// Referenz-Verdunstung fuer den Fallback-Faktor (typischer Sommertag, mm/Tag).
const ET0_REF_MM_PER_DAY = 4;

// ── Empfehlung ──────────────────────────────────────────────────────────────

export type IrrigationLevel = "skip" | "reduced" | "normal" | "increased";

export interface IrrigationRecommendation {
  shouldWater: boolean;
  /// Multiplikator auf die Basisdauer (0 = nicht bewässern).
  factor: number;
  level: IrrigationLevel;
  reason: string;
}

/**
 * Leitet aus dem Wetter eine Bewässerungs-Empfehlung ab.
 *  - Regen erwartet (viel Niederschlag oder hohe Wahrscheinlichkeit) → aussetzen
 *  - Heiß/trocken → mehr, kühl → weniger
 */
export function getIrrigationRecommendation(weather: Weather | null): IrrigationRecommendation {
  if (!weather) {
    return { shouldWater: true, factor: 1, level: "normal", reason: "Keine Wetterdaten – Standardbewässerung." };
  }

  const rain = weather.precipSumToday ?? 0;
  const prob = weather.precipProbToday ?? 0;
  const tMax = weather.tempMaxToday ?? weather.currentTemp ?? 18;

  // Deutlicher Regen → aussetzen.
  if (rain >= 4 || prob >= 70) {
    return {
      shouldWater: false,
      factor: 0,
      level: "skip",
      reason: `Regen erwartet (${Math.round(rain)} mm, ${Math.round(prob)} %) – Bewässerung heute nicht nötig.`,
    };
  }

  let factor = 1;
  let level: IrrigationLevel = "normal";
  const parts: string[] = [];

  if (tMax >= 30) {
    factor = 1.5; level = "increased"; parts.push(`sehr heiß (${Math.round(tMax)} °C)`);
  } else if (tMax >= 25) {
    factor = 1.25; level = "increased"; parts.push(`warm (${Math.round(tMax)} °C)`);
  } else if (tMax <= 12) {
    factor = 0.5; level = "reduced"; parts.push(`kühl (${Math.round(tMax)} °C)`);
  } else if (tMax <= 16) {
    factor = 0.75; level = "reduced"; parts.push(`eher kühl (${Math.round(tMax)} °C)`);
  } else {
    parts.push(`mild (${Math.round(tMax)} °C)`);
  }

  // Mäßige Regenwahrscheinlichkeit → etwas reduzieren.
  if (prob >= 40) {
    factor *= 0.7;
    if (level === "normal" || level === "increased") level = "reduced";
    parts.push(`${Math.round(prob)} % Regenrisiko`);
  }

  const reason =
    level === "increased"
      ? `Empfehlung: mehr bewässern – ${parts.join(", ")}.`
      : level === "reduced"
        ? `Empfehlung: reduziert bewässern – ${parts.join(", ")}.`
        : `Normale Bewässerung – ${parts.join(", ")}.`;

  return { shouldWater: true, factor, level, reason };
}

/** Empfohlene Dauer (Minuten) fuer eine Basisdauer, geclamped auf 5–90 Min. */
export function recommendedMinutes(base: number, rec: IrrigationRecommendation): number {
  if (!rec.shouldWater) return 0;
  return Math.min(90, Math.max(5, Math.round(base * rec.factor)));
}

// ── Wasserbilanz (ET₀ − Regen) ──────────────────────────────────────────────

/**
 * Wasserdefizit in mm ueber die letzten `windowDays` Tage (inkl. heute):
 * Summe der Referenz-Verdunstung (FAO ET₀) minus gefallener/erwarteter Regen.
 * 1 mm Defizit = 1 Liter pro m². Gibt null zurueck, wenn keine ET₀-Daten
 * vorliegen. Ergebnis auf 0–30 mm begrenzt (Schutz vor Extremwerten).
 */
export function waterDeficitMm(weather: Weather | null, windowDays: number): number | null {
  if (!weather || weather.et0Today == null) return null;
  let deficit = weather.et0Today - (weather.precipSumToday ?? 0);
  const pastDays = Math.min(Math.max(0, windowDays - 1), weather.et0Past.length);
  for (let i = 0; i < pastDays; i++) {
    deficit += (weather.et0Past[i] ?? 0) - (weather.precipPast[i] ?? 0);
  }
  return Math.min(30, Math.max(0, Math.round(deficit * 10) / 10));
}

// ── Bodenfeuchte-Anpassung ──────────────────────────────────────────────────

export interface MoistureAdjustment {
  skip: boolean;
  /// Multiplikator auf die geplante Dauer (nur relevant wenn skip=false).
  factor: number;
  reason: string;
}

/**
 * Leitet aus der gemessenen Bodenfeuchte eine Anpassung des Zeitplan-Laufs ab.
 *  - Feuchte >= Schwelle           → Lauf aussetzen (Boden feucht genug)
 *  - Feuchte >= 75 % der Schwelle  → halbe Dauer (fast feucht genug)
 *  - Feuchte <= 25 % der Schwelle  → 25 % laenger (sehr trocken)
 *  - sonst                         → geplante Dauer
 */
export function moistureAdjustment(humidityPct: number, thresholdPct: number): MoistureAdjustment {
  if (humidityPct >= thresholdPct) {
    return {
      skip: true,
      factor: 0,
      reason: `Boden feucht genug (${Math.round(humidityPct)} % ≥ ${thresholdPct} %) – Bewässerung ausgesetzt.`,
    };
  }
  if (humidityPct >= thresholdPct * 0.75) {
    return {
      skip: false,
      factor: 0.5,
      reason: `Boden fast feucht genug (${Math.round(humidityPct)} %) – Dauer halbiert.`,
    };
  }
  if (humidityPct <= thresholdPct * 0.25) {
    return {
      skip: false,
      factor: 1.25,
      reason: `Boden sehr trocken (${Math.round(humidityPct)} %) – Dauer verlaengert.`,
    };
  }
  return { skip: false, factor: 1, reason: `Boden trocken (${Math.round(humidityPct)} %) – geplante Dauer.` };
}

// ── Verbrauchs-Schätzung ────────────────────────────────────────────────────

export function bitCount(mask: number): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if ((mask >> i) & 1) n++;
  return n;
}

/** Geschätzter Wasserverbrauch pro Woche (Liter) aus aktiven Zeitplänen. */
export function estimateWeeklyLiters(
  schedules: { daysOfWeek: number; durationMinutes: number; isActive: boolean }[],
): number {
  return schedules
    .filter((s) => s.isActive)
    .reduce((sum, s) => sum + bitCount(s.daysOfWeek) * s.durationMinutes * (ASSUMED_FLOW_L_PER_HOUR / 60), 0);
}

// ── Zeit-Helfer (IANA-TZ, ohne Dependencies) ────────────────────────────────

/** Wochentag als Bit-Index (0=Mo … 6=So) in der angegebenen Zeitzone. */
export function weekdayBitIndex(now: Date, tz: string | null | undefined): number {
  const timeZone = tz ?? "Europe/Berlin";
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(now)
    .toLowerCase();
  const map: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  return map[weekday] ?? 0;
}

/** Konvertiert "HH:mm" (in tz, heute) zu einem UTC-Date. DST-robust. */
export function timeOfDayToUtc(now: Date, hhmm: string, tz: string | null | undefined): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const timeZone = tz ?? "Europe/Berlin";
  const h = Number(m[1]);
  const min = Number(m[2]);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const mo = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  let guess = new Date(Date.UTC(y, mo - 1, d, h, min, 0));
  for (let i = 0; i < 2; i++) {
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(guess);
    const gy = Number(shown.find((p) => p.type === "year")?.value);
    const gmo = Number(shown.find((p) => p.type === "month")?.value);
    const gd = Number(shown.find((p) => p.type === "day")?.value);
    const gh = Number(shown.find((p) => p.type === "hour")?.value);
    const gm = Number(shown.find((p) => p.type === "minute")?.value);
    const diff = Date.UTC(y, mo - 1, d, h, min, 0) - Date.UTC(gy, gmo - 1, gd, gh, gm, 0);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

// ── Tick-Kontext (Caches fuer Wetter, Zugangsdaten, Sensoren) ───────────────

interface GardenaCreds { key: string; secret: string }

interface TickCtx {
  accountWeather(accId: number, lat: number | null, lng: number | null): Promise<Weather | null>;
  credsForDevice(accId: number, configId: number | null): Promise<GardenaCreds | null>;
  sensorHumidity(creds: GardenaCreds, serviceId: string): Promise<number | null>;
}

function createTickCtx(): TickCtx {
  const weatherCache = new Map<number, Weather | null>();
  const credByConfig = new Map<number, GardenaCreds | null>();
  const fallbackConfigByAccount = new Map<number, number | null>();
  const sensorCacheByKey = new Map<string, Map<string, number | null>>();

  async function credsForConfig(configId: number) {
    if (!credByConfig.has(configId)) {
      const cfg = await prisma.apiConfig.findFirst({ where: { id: configId, provider: "GARDENA" } });
      credByConfig.set(configId, cfg?.token && cfg?.extraConfig ? { key: cfg.token, secret: cfg.extraConfig } : null);
    }
    return credByConfig.get(configId)!;
  }

  return {
    async accountWeather(accId, lat, lng) {
      if (!weatherCache.has(accId)) weatherCache.set(accId, await getWeather(lat, lng));
      return weatherCache.get(accId)!;
    },
    // Zugangsdaten fuer ein Geraet: bevorzugt dessen Verbindung, sonst erste
    // GARDENA-Verbindung des Accounts (Alt-Geraete ohne gardenaConfigId).
    async credsForDevice(accId, configId) {
      if (configId) return credsForConfig(configId);
      if (!fallbackConfigByAccount.has(accId)) {
        const cfg = await prisma.apiConfig.findFirst({ where: { accountId: accId, provider: "GARDENA" } });
        fallbackConfigByAccount.set(accId, cfg?.id ?? null);
        if (cfg) credByConfig.set(cfg.id, cfg.token && cfg.extraConfig ? { key: cfg.token, secret: cfg.extraConfig } : null);
      }
      const fb = fallbackConfigByAccount.get(accId);
      return fb ? credsForConfig(fb) : null;
    },
    // Bodenfeuchte (%) eines SENSOR-Service; ein Abruf je Verbindung pro Tick.
    async sensorHumidity(creds, serviceId) {
      if (!sensorCacheByKey.has(creds.key)) {
        const res = await gardenaListSensors(creds.key, creds.secret);
        const m = new Map<string, number | null>();
        if (res.ok) for (const sensor of res.sensors) m.set(sensor.serviceId, sensor.soilHumidity);
        sensorCacheByKey.set(creds.key, m);
      }
      return sensorCacheByKey.get(creds.key)!.get(serviceId) ?? null;
    },
  };
}

// ── Sequenz-Plan (runState) ─────────────────────────────────────────────────

export interface RunStep {
  deviceId: number;
  minutes: number;
  /// Start-Versatz in Minuten relativ zum Plan-Start.
  offsetMin: number;
  /// ISO-Zeitpunkt, wenn der Schritt gestartet wurde.
  startedAt?: string;
}

export interface RunState {
  startedAt: string;
  /// Quelle des Plans (bleibt ueber alle Sequenz-Schritte gleich).
  source?: IrrigationRunSource;
  steps: RunStep[];
}

export function parseRunState(v: unknown): RunState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { startedAt?: unknown; steps?: unknown };
  if (typeof o.startedAt !== "string" || !Array.isArray(o.steps)) return null;
  return o as unknown as RunState;
}

interface ScheduleForSmart {
  smartRain: boolean;
  skipOnRain: boolean;
  sensorServiceId: string | null;
  moistureThresholdPct: number | null;
  lastRunAt: Date | null;
  daysOfWeek: number;
}

interface SmartOutcome {
  skip: "rain" | "moisture" | null;
  /// Gesamt-Faktor auf die Basisdauer (Fallback ohne Zonen-Stammdaten).
  factor: number;
  /// Wasserdefizit in mm seit dem letzten Lauf (nur bei smartRain + ET₀-Daten).
  deficitMm: number | null;
  /// Feuchte-Faktor separat – wird auch auf die exakte Bilanz-Dauer angewendet.
  moistureFactor: number;
  reason?: string;
}

/**
 * Bilanz-Fenster in Tagen: Zeit seit dem letzten Lauf, sonst aus der
 * Wochentags-Frequenz geschaetzt. Begrenzt auf die verfuegbaren Wetterdaten
 * (heute + WEATHER_PAST_DAYS Vortage).
 */
function smartWindowDays(s: { lastRunAt: Date | null; daysOfWeek: number }, now: Date): number {
  const maxWindow = WEATHER_PAST_DAYS + 1;
  if (s.lastRunAt) {
    const days = Math.round((now.getTime() - s.lastRunAt.getTime()) / 86_400_000);
    return Math.min(maxWindow, Math.max(1, days));
  }
  const runsPerWeek = bitCount(s.daysOfWeek) || 1;
  return Math.min(maxWindow, Math.max(1, Math.round(7 / runsPerWeek)));
}

/**
 * Kombiniert Regen-, Bilanz- und Feuchte-Intelligenz zu einem Skip bzw.
 * Dauer-Parametern:
 *  - skipOnRain: deutlicher Regen → aussetzen
 *  - smartRain:  Wasserbilanz (ET₀ − Regen seit letztem Lauf). Defizit ≈ 0 →
 *    aussetzen; sonst Defizit in mm fuer die exakte Dauer-Berechnung bzw.
 *    Fallback-Faktor relativ zu einem typischen Sommertag.
 *  - Sensor:     Boden feucht genug → aussetzen, sonst Feuchte-Faktor
 */
async function computeSmartOutcome(
  s: ScheduleForSmart,
  account: { id: number; latitude: number | null; longitude: number | null },
  deviceCreds: GardenaCreds | null,
  ctx: TickCtx,
  now: Date,
): Promise<SmartOutcome> {
  let rainFactor = 1;
  let moistureFactor = 1;
  let deficitMm: number | null = null;
  const notes: string[] = [];

  if (s.skipOnRain || s.smartRain) {
    const weather = await ctx.accountWeather(account.id, account.latitude, account.longitude);
    const rec = getIrrigationRecommendation(weather);
    if (!rec.shouldWater) {
      return { skip: "rain", factor: 0, deficitMm: null, moistureFactor: 0, reason: rec.reason };
    }
    if (s.smartRain) {
      const windowDays = smartWindowDays(s, now);
      deficitMm = waterDeficitMm(weather, windowDays);
      if (deficitMm != null) {
        if (deficitMm < 1) {
          return {
            skip: "rain", factor: 0, deficitMm, moistureFactor: 0,
            reason: `Wasserbilanz ausgeglichen (Defizit ${deficitMm} mm über ${windowDays} Tag(e)) – Bewässerung nicht nötig.`,
          };
        }
        rainFactor = Math.min(1.5, Math.max(0.3, deficitMm / (ET0_REF_MM_PER_DAY * windowDays)));
        notes.push(`Wasserdefizit ${deficitMm} mm über ${windowDays} Tag(e) (ET₀ − Regen).`);
      } else if (rec.factor !== 1) {
        // Keine ET₀-Daten → grobe Wetter-Heuristik als Fallback.
        rainFactor = rec.factor;
        notes.push(rec.reason);
      }
    }
  }

  if (s.sensorServiceId && s.moistureThresholdPct != null && deviceCreds) {
    const humidity = await ctx.sensorHumidity(deviceCreds, s.sensorServiceId);
    if (humidity != null) {
      const adj = moistureAdjustment(humidity, s.moistureThresholdPct);
      if (adj.skip) return { skip: "moisture", factor: 0, deficitMm, moistureFactor: 0, reason: adj.reason };
      if (adj.factor !== 1) {
        moistureFactor = adj.factor;
        notes.push(adj.reason);
      }
    }
    // Sensor nicht erreichbar/kein Wert → normal bewaessern (fail-open).
  }

  return {
    skip: null,
    factor: rainFactor * moistureFactor,
    deficitMm,
    moistureFactor,
    reason: notes.length ? notes.join(" ") : undefined,
  };
}

function clampRunMinutes(minutes: number): number {
  return Math.min(180, Math.max(1, Math.round(minutes)));
}

interface ZoneMeta { areaSqm: number | null; flowLph: number | null }

/**
 * Dauer fuer ein Ventil in Minuten:
 *  - Mit Wasserdefizit + Zonen-Stammdaten (Flaeche, Durchsatz) exakt:
 *    Liter = Defizit (mm) × Flaeche (m²); Minuten = Liter ÷ Durchsatz (L/h ÷ 60),
 *    Feuchte-Faktor obendrauf, begrenzt auf 5–120 Min.
 *  - Sonst Basisdauer × Smart-Faktor (1–180 Min).
 */
function minutesForValve(smart: SmartOutcome, baseMinutes: number, zone: ZoneMeta | undefined): number {
  if (smart.deficitMm != null && zone?.areaSqm && zone?.flowLph) {
    const liters = smart.deficitMm * zone.areaSqm;
    return Math.min(120, Math.max(5, Math.round((liters / (zone.flowLph / 60)) * smart.moistureFactor)));
  }
  return clampRunMinutes(baseMinutes * smart.factor);
}

/** Zonen-Stammdaten (Flaeche/Durchsatz) fuer eine Menge von Ventilen. */
async function loadZoneMeta(valveIds: number[]): Promise<Map<number, ZoneMeta>> {
  const devices = await prisma.device.findMany({
    where: { id: { in: valveIds } },
    select: { id: true, areaSqm: true, flowLph: true },
  });
  return new Map(devices.map((d) => [d.id, { areaSqm: d.areaSqm, flowLph: d.flowLph }]));
}

/** Baut den Sequenz-Plan: Ventile nacheinander, jedes mit eigener Dauer. */
function buildRunState(
  now: Date,
  valves: Array<{ deviceId: number; minutes: number }>,
  source: IrrigationRunSource,
): RunState {
  let offset = 0;
  const steps: RunStep[] = valves.map(({ deviceId, minutes }) => {
    const step = { deviceId, minutes, offsetMin: offset };
    offset += minutes;
    return step;
  });
  return { startedAt: now.toISOString(), source, steps };
}

interface PumpRef { serviceId: string | null; configId: number | null; accountId: number }

/**
 * Startet alle faelligen Schritte eines Plans (Ventil + Pumpe fuer die
 * Schrittdauer) und persistiert den Fortschritt. Gibt zurueck, ob der Plan
 * abgeschlossen ist.
 */
async function executeDueSteps(
  scheduleId: number,
  pump: PumpRef | null,
  state: RunState,
  ctx: TickCtx,
  now: Date,
): Promise<{ startedNames: string[]; finished: boolean }> {
  const planStart = new Date(state.startedAt).getTime();
  const due = state.steps.filter(
    (st) => !st.startedAt && now.getTime() >= planStart + st.offsetMin * 60_000,
  );
  const startedNames: string[] = [];

  if (due.length > 0) {
    const devices = await prisma.device.findMany({
      where: { id: { in: due.map((d) => d.deviceId) } },
      select: { id: true, name: true, accountId: true, gardenaServiceId: true, gardenaConfigId: true, isActive: true, flowLph: true },
    });
    const byId = new Map(devices.map((d) => [d.id, d]));
    const runSource = state.source ?? "schedule";

    for (const step of due) {
      step.startedAt = now.toISOString();
      const dev = byId.get(step.deviceId);
      if (!dev?.gardenaServiceId || !dev.isActive) continue;
      const creds = await ctx.credsForDevice(dev.accountId, dev.gardenaConfigId);
      if (!creds) continue;
      const seconds = step.minutes * 60;
      const res = await gardenaControlValve(creds.key, creds.secret, dev.gardenaServiceId, "open", seconds);
      if (res.ok) {
        startedNames.push(dev.name);
        await logIrrigationRun({
          accountId: dev.accountId,
          deviceId: dev.id,
          durationMinutes: step.minutes,
          source: runSource,
          scheduleId,
          flowLph: dev.flowLph,
          startedAt: now,
        });
      }
      // Pumpe fuer die Schrittdauer mitstarten (best effort).
      if (pump?.serviceId) {
        const pumpCreds = await ctx.credsForDevice(pump.accountId, pump.configId);
        if (pumpCreds) {
          await gardenaControlValve(pumpCreds.key, pumpCreds.secret, pump.serviceId, "open", seconds)
            .catch(() => undefined);
        }
      }
    }
  }

  const allStarted = state.steps.every((st) => st.startedAt);
  const last = state.steps[state.steps.length - 1];
  const finished =
    allStarted && (!last || now.getTime() >= planStart + (last.offsetMin + last.minutes) * 60_000);

  await prisma.irrigationSchedule.update({
    where: { id: scheduleId },
    data: { runState: finished ? { set: null } : (JSON.parse(JSON.stringify(state)) as object) },
  });

  return { startedNames, finished };
}

/** Ventil-Sequenz eines Zeitplans als Device-ID-Array (oder null). */
export function parseValveSequence(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const ids = v.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : null;
}

// ── Manueller Start/Stopp (UI "Jetzt"/"Stopp") ──────────────────────────────

/**
 * Startet einen Zeitplan sofort – inkl. Smart-Anpassung (Regen/Feuchte) und
 * Sequenz-Plan. `lastRunAt` bleibt unberuehrt (der regulaere Lauf zur
 * geplanten Zeit findet weiterhin statt).
 *
 * `force` uebergeht die Smart-Checks (Regen/Feuchte) komplett und startet mit
 * den geplanten Basisdauern – fuer den manuellen "Trotzdem starten"-Fall.
 */
export async function startScheduleRun(
  scheduleId: number,
  accountId: number,
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const s = await prisma.irrigationSchedule.findFirst({
    where: { id: scheduleId, accountId },
    include: {
      device: { select: { id: true, name: true, accountId: true, gardenaServiceId: true, gardenaConfigId: true, isActive: true, areaSqm: true, flowLph: true, pump: { select: { gardenaServiceId: true, gardenaConfigId: true } } } },
      account: { select: { id: true, latitude: true, longitude: true, timezone: true } },
    },
  });
  if (!s?.device) return { ok: false, error: "Zeitplan nicht gefunden" };

  const ctx = createTickCtx();
  const now = new Date();
  const deviceCreds = await ctx.credsForDevice(s.account.id, s.device.gardenaConfigId);
  const smart: SmartOutcome = options.force
    ? { skip: null, factor: 1, deficitMm: null, moistureFactor: 1 }
    : await computeSmartOutcome(s, s.account, deviceCreds, ctx, now);
  if (smart.skip) return { ok: true, skipped: smart.reason ?? "Smart-Check: ausgesetzt" };

  const sequence = parseValveSequence(s.valveSequence);

  if (sequence) {
    // deviceId = Pumpe; Ventile laufen nacheinander, jedes mit eigener Dauer.
    const zoneMeta = await loadZoneMeta(sequence);
    const state = buildRunState(
      now,
      sequence.map((deviceId) => ({
        deviceId,
        minutes: minutesForValve(smart, s.durationMinutes, zoneMeta.get(deviceId)),
      })),
      "schedule_now",
    );
    const pump: PumpRef = {
      serviceId: s.device.gardenaServiceId,
      configId: s.device.gardenaConfigId,
      accountId: s.account.id,
    };
    await executeDueSteps(s.id, pump, state, ctx, now);
    return { ok: true };
  }

  // Einzel-Ventil (Legacy): direkt oeffnen, Pumpe mitschalten.
  if (!s.device.gardenaServiceId || !deviceCreds) return { ok: false, error: "Keine GARDENA-Zugangsdaten" };
  const minutes = minutesForValve(smart, s.durationMinutes, s.device);
  const res = await gardenaControlValve(deviceCreds.key, deviceCreds.secret, s.device.gardenaServiceId, "open", minutes * 60);
  if (res.ok) {
    await logIrrigationRun({
      accountId: s.account.id,
      deviceId: s.device.id,
      durationMinutes: minutes,
      source: "schedule_now",
      scheduleId: s.id,
      flowLph: s.device.flowLph,
      startedAt: now,
    });
  }
  if (s.device.pump?.gardenaServiceId) {
    const pumpCreds = await ctx.credsForDevice(s.account.id, s.device.pump.gardenaConfigId);
    if (pumpCreds) {
      await gardenaControlValve(pumpCreds.key, pumpCreds.secret, s.device.pump.gardenaServiceId, "open", minutes * 60)
        .catch(() => undefined);
    }
  }
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Stoppt einen laufenden Zeitplan: alle Sequenz-Ventile + Pumpe schliessen. */
export async function stopScheduleRun(
  scheduleId: number,
  accountId: number,
): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.irrigationSchedule.findFirst({
    where: { id: scheduleId, accountId },
    include: {
      device: { select: { id: true, accountId: true, gardenaServiceId: true, gardenaConfigId: true, pump: { select: { gardenaServiceId: true, gardenaConfigId: true } } } },
      account: { select: { id: true } },
    },
  });
  if (!s?.device) return { ok: false, error: "Zeitplan nicht gefunden" };

  const ctx = createTickCtx();
  const sequence = parseValveSequence(s.valveSequence);
  const valveIds = sequence ?? [s.deviceId];

  const devices = await prisma.device.findMany({
    where: { id: { in: valveIds } },
    select: { id: true, accountId: true, gardenaServiceId: true, gardenaConfigId: true },
  });
  for (const dev of devices) {
    if (!dev.gardenaServiceId) continue;
    const creds = await ctx.credsForDevice(dev.accountId, dev.gardenaConfigId);
    if (!creds) continue;
    await gardenaControlValve(creds.key, creds.secret, dev.gardenaServiceId, "close").catch(() => undefined);
  }

  // Pumpe schliessen: bei Sequenz ist deviceId die Pumpe, sonst die Zuordnung.
  const pumpService = sequence ? s.device.gardenaServiceId : s.device.pump?.gardenaServiceId;
  const pumpConfig = sequence ? s.device.gardenaConfigId : s.device.pump?.gardenaConfigId ?? null;
  if (pumpService) {
    const creds = await ctx.credsForDevice(s.device.accountId, pumpConfig);
    if (creds) await gardenaControlValve(creds.key, creds.secret, pumpService, "close").catch(() => undefined);
  }

  await prisma.irrigationSchedule.update({ where: { id: s.id }, data: { runState: { set: null } } });
  return { ok: true };
}

// ── Cron-Tick ───────────────────────────────────────────────────────────────

export interface IrrigationTickResult {
  checked: number;
  watered: number;
  skippedRain: number;
  skippedMoisture: number;
  failed: number;
  /// Anzahl gestarteter Sequenz-Schritte laufender Plaene.
  stepsStarted: number;
  results: Array<{ scheduleId: number; deviceName: string; action: "watered" | "skipped" | "failed" | "step"; reason?: string }>;
}

/**
 * Prüft alle aktiven Zeitpläne und startet fällige Bewässerungen.
 *  - Laufende Sequenz-Plaene (runState) werden fortgesetzt: der jeweils
 *    naechste faellige Schritt (Ventil + Pumpe) wird gestartet.
 *  - Faellige Zeitplaene (0–6 Min nach Startzeit) werden geclaimt (lastRunAt),
 *    Smart-Checks (Regen/Feuchte) angewendet und gestartet: mit Ventil-Sequenz
 *    als Plan, sonst als Einzel-Ventil.
 */
export async function runIrrigationTick(now: Date = new Date()): Promise<IrrigationTickResult> {
  const FIRE_WINDOW_MS = 6 * 60_000;
  const RERUN_GUARD_MS = 6 * 60 * 60_000; // 6h – Zeitpläne laufen ≤ 1x/Tag.

  const schedules = await prisma.irrigationSchedule.findMany({
    where: { isActive: true },
    include: {
      device: {
        select: {
          id: true, name: true, type: true, accountId: true, gardenaServiceId: true, gardenaConfigId: true, isActive: true,
          areaSqm: true, flowLph: true, pumpDeviceId: true,
          pump: { select: { id: true, gardenaServiceId: true, gardenaConfigId: true } },
        },
      },
      account: { select: { id: true, latitude: true, longitude: true, timezone: true } },
    },
  });

  const results: IrrigationTickResult["results"] = [];
  let watered = 0, skippedRain = 0, skippedMoisture = 0, failed = 0, stepsStarted = 0;
  const ctx = createTickCtx();

  for (const s of schedules) {
    if (!s.device || s.device.type !== "GARDENA_VALVE" || !s.device.isActive) continue;

    // ── Phase A: laufenden Sequenz-Plan fortsetzen ───────────────────────────
    const activeState = parseRunState(s.runState);
    if (activeState) {
      const pump: PumpRef = {
        serviceId: s.device.gardenaServiceId,
        configId: s.device.gardenaConfigId,
        accountId: s.account.id,
      };
      const { startedNames } = await executeDueSteps(s.id, pump, activeState, ctx, now);
      stepsStarted += startedNames.length;
      for (const name of startedNames) {
        results.push({ scheduleId: s.id, deviceName: name, action: "step", reason: "Sequenz-Schritt gestartet" });
      }
      continue; // Waehrend ein Plan laeuft, keinen neuen Lauf starten.
    }

    // ── Phase B: faellige Zeitplaene starten ────────────────────────────────
    const dow = weekdayBitIndex(now, s.account.timezone);
    if (((s.daysOfWeek >> dow) & 1) !== 1) continue;

    if (s.lastRunAt && now.getTime() - s.lastRunAt.getTime() < RERUN_GUARD_MS) continue;

    const scheduledAt = timeOfDayToUtc(now, s.startTime, s.account.timezone);
    if (!scheduledAt) continue;
    const delta = now.getTime() - scheduledAt.getTime();
    if (delta < 0 || delta > FIRE_WINDOW_MS) continue;

    // Atomar claimen, damit parallele Cron-Läufe nicht doppelt feuern.
    const claimed = await prisma.irrigationSchedule.updateMany({
      where: {
        id: s.id,
        OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - RERUN_GUARD_MS) } }],
      },
      data: { lastRunAt: now },
    });
    if (claimed.count === 0) continue;

    const deviceCreds = await ctx.credsForDevice(s.account.id, s.device.gardenaConfigId);

    // Smart-Checks: Wasserbilanz/Regen und Bodenfeuchte (aussetzen/skalieren).
    const smart = await computeSmartOutcome(s, s.account, deviceCreds, ctx, now);
    if (smart.skip) {
      if (smart.skip === "rain") skippedRain++; else skippedMoisture++;
      results.push({ scheduleId: s.id, deviceName: s.device.name, action: "skipped", reason: smart.reason });
      continue;
    }

    const sequence = parseValveSequence(s.valveSequence);

    if (sequence) {
      // Sequenz: deviceId ist die Pumpe, Ventile laufen nacheinander – jedes
      // mit eigener Dauer (Wasserbilanz × Zonen-Stammdaten, sonst Basisdauer).
      const zoneMeta = await loadZoneMeta(sequence);
      const stepMinutes = sequence.map((deviceId) => ({
        deviceId,
        minutes: minutesForValve(smart, s.durationMinutes, zoneMeta.get(deviceId)),
      }));
      const state = buildRunState(now, stepMinutes, "schedule");
      const pump: PumpRef = {
        serviceId: s.device.gardenaServiceId,
        configId: s.device.gardenaConfigId,
        accountId: s.account.id,
      };
      const { startedNames } = await executeDueSteps(s.id, pump, state, ctx, now);
      stepsStarted += startedNames.length;
      watered++;
      const minText = [...new Set(stepMinutes.map((st) => st.minutes))].sort((a, b) => a - b);
      results.push({
        scheduleId: s.id,
        deviceName: s.device.name,
        action: "watered",
        reason: [
          `Sequenz mit ${sequence.length} Ventilen à ${minText.length === 1 ? minText[0] : `${minText[0]}–${minText[minText.length - 1]}`} Min gestartet.`,
          smart.reason,
        ].filter(Boolean).join(" "),
      });
      continue;
    }

    // Einzel-Ventil (Legacy).
    if (!s.device.gardenaServiceId || !deviceCreds) {
      failed++;
      results.push({ scheduleId: s.id, deviceName: s.device.name, action: "failed", reason: "Keine GARDENA-Zugangsdaten" });
      continue;
    }

    const runMinutes = minutesForValve(smart, s.durationMinutes, s.device);
    const seconds = runMinutes * 60;
    const res = await gardenaControlValve(
      deviceCreds.key, deviceCreds.secret, s.device.gardenaServiceId, "open", seconds,
    );
    if (res.ok) {
      await logIrrigationRun({
        accountId: s.account.id,
        deviceId: s.device.id,
        durationMinutes: runMinutes,
        source: "schedule",
        scheduleId: s.id,
        flowLph: s.device.flowLph,
        startedAt: now,
      });
      // Zugeordnete Pumpe fuer die gleiche Laufzeit mitstarten (best effort).
      const pump = s.device.pump;
      if (pump?.gardenaServiceId) {
        const pumpCreds = await ctx.credsForDevice(s.account.id, pump.gardenaConfigId);
        if (pumpCreds) {
          await gardenaControlValve(pumpCreds.key, pumpCreds.secret, pump.gardenaServiceId, "open", seconds)
            .catch(() => undefined);
        }
      }
      watered++;
      results.push({ scheduleId: s.id, deviceName: s.device.name, action: "watered", reason: smart.reason });
    } else {
      failed++;
      results.push({ scheduleId: s.id, deviceName: s.device.name, action: "failed", reason: res.error });
    }
  }

  return { checked: schedules.length, watered, skippedRain, skippedMoisture, failed, stepsStarted, results };
}

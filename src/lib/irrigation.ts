/**
 * Smarte Bewässerungs-Logik: Wetter-Empfehlung, Zeitplan-Auswertung fuer den
 * Cron und Verbrauchs-Schätzung.
 *
 * Zeitpläne (`IrrigationSchedule`) steuern GARDENA-Ventile (Device mit
 * type = GARDENA_VALVE). Der Cron (`/api/cron/irrigation`) ruft `runIrrigationTick`
 * alle 5 Minuten auf.
 */

import { prisma } from "@/lib/prisma";
import { getWeather, type Weather } from "@/lib/weather";
import { gardenaControlValve } from "@/lib/gardena";

// Angenommener Durchfluss pro Ventil/Zone (Liter pro Minute). GARDENA liefert
// keine Durchflussdaten – dies ist eine grobe Schätzung fuer die Statistik.
export const ASSUMED_FLOW_L_PER_MIN = 12;

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
    .reduce((sum, s) => sum + bitCount(s.daysOfWeek) * s.durationMinutes * ASSUMED_FLOW_L_PER_MIN, 0);
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

// ── Cron-Tick ───────────────────────────────────────────────────────────────

export interface IrrigationTickResult {
  checked: number;
  watered: number;
  skippedRain: number;
  failed: number;
  results: Array<{ scheduleId: number; deviceName: string; action: "watered" | "skipped" | "failed"; reason?: string }>;
}

/**
 * Prüft alle aktiven Zeitpläne und startet fällige Bewässerungen.
 * Fenster: fällig, wenn `now` 0–6 Min nach der geplanten Zeit liegt (5-Min-Cron
 * mit Catch-up). `lastRunAt` (Claim via updateMany) verhindert Doppel-Ausführung.
 */
export async function runIrrigationTick(now: Date = new Date()): Promise<IrrigationTickResult> {
  const FIRE_WINDOW_MS = 6 * 60_000;
  const RERUN_GUARD_MS = 6 * 60 * 60_000; // 6h – Zeitpläne laufen ≤ 1x/Tag.

  const schedules = await prisma.irrigationSchedule.findMany({
    where: { isActive: true },
    include: {
      device: { select: { id: true, name: true, type: true, gardenaServiceId: true, isActive: true } },
      account: { select: { id: true, latitude: true, longitude: true, timezone: true } },
    },
  });

  const results: IrrigationTickResult["results"] = [];
  let watered = 0, skippedRain = 0, failed = 0;

  // Wetter + GARDENA-Zugangsdaten pro Account cachen (mehrere Zeitpläne teilen sie).
  const weatherCache = new Map<number, Weather | null>();
  const credCache = new Map<number, { key: string; secret: string } | null>();

  async function accountWeather(accId: number, lat: number | null, lng: number | null) {
    if (!weatherCache.has(accId)) weatherCache.set(accId, await getWeather(lat, lng));
    return weatherCache.get(accId)!;
  }
  async function accountCreds(accId: number) {
    if (!credCache.has(accId)) {
      const cfg = await prisma.apiConfig.findFirst({ where: { accountId: accId, provider: "GARDENA" } });
      credCache.set(accId, cfg?.token && cfg?.extraConfig ? { key: cfg.token, secret: cfg.extraConfig } : null);
    }
    return credCache.get(accId)!;
  }

  for (const s of schedules) {
    if (!s.device || s.device.type !== "GARDENA_VALVE" || !s.device.gardenaServiceId || !s.device.isActive) {
      continue;
    }

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

    // Wetter-Check (Regen).
    if (s.skipOnRain) {
      const weather = await accountWeather(s.account.id, s.account.latitude, s.account.longitude);
      const rec = getIrrigationRecommendation(weather);
      if (!rec.shouldWater) {
        skippedRain++;
        results.push({ scheduleId: s.id, deviceName: s.device.name, action: "skipped", reason: rec.reason });
        continue;
      }
    }

    const creds = await accountCreds(s.account.id);
    if (!creds) {
      failed++;
      results.push({ scheduleId: s.id, deviceName: s.device.name, action: "failed", reason: "Keine GARDENA-Zugangsdaten" });
      continue;
    }

    const res = await gardenaControlValve(
      creds.key, creds.secret, s.device.gardenaServiceId, "open", s.durationMinutes * 60,
    );
    if (res.ok) {
      watered++;
      results.push({ scheduleId: s.id, deviceName: s.device.name, action: "watered" });
    } else {
      failed++;
      results.push({ scheduleId: s.id, deviceName: s.device.name, action: "failed", reason: res.error });
    }
  }

  return { checked: schedules.length, watered, skippedRain, failed, results };
}

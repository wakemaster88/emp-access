import { prisma } from "./prisma";
import { berlinDayStart } from "./berlin-day";

/**
 * Auslastung im Strandbad für Kunden-App und Verwaltung.
 *
 * Die Eingangs-Drehkreuze sehen nur einen Teil der Gäste: Wer an der
 * Tageskasse zahlt, kommt ohne Scan rein (Aaron, 21.11.2026: an Top-Tagen
 * 3000 Gäste, davon 2/3 Tageskasse). Geschätzt wird deshalb:
 *
 *   Gäste vor Ort ≈ erfolgreiche Eintritte der letzten 3 Stunden × Faktor
 *
 * Die meisten Gäste bleiben ein paar Stunden. Ausgänge werden kaum gescannt
 * und zählen nicht. Vorgabe 600 / 1200 (20 % / 40 % von 3000): „Viel los“
 * stand damit 2026 an 8 von 118 Tagen, 2 % der Öffnungszeit.
 */
export const BEACH_WINDOW_MIN = 180;
/** Bereich, wenn nichts anderes passt: Name enthält „Strandbad“. */
const BEACH_AREA_NAME = /strandbad/i;

import { DEFAULT_BEACH_SETTINGS, type BeachLevel, type BeachSettings } from "./beach-occupancy-labels";

export { BEACH_LABEL, DEFAULT_BEACH_SETTINGS, type BeachLevel, type BeachSettings } from "./beach-occupancy-labels";

export interface BeachOccupancy {
  areaName: string;
  /** Erfolgreiche Eintritte der letzten 3 Stunden. */
  entries: number;
  /** Geschätzte Gäste vor Ort (Eintritte × Faktor, gerundet auf 10). */
  estimated: number;
  capacity: number | null;
  level: BeachLevel;
  /** Balken 0–100: Anteil der Kapazität, ohne Kapazität bis 1,4 × „Viel los“. */
  percent: number;
  at: Date;
  settings: BeachSettings;
}

export function normalizeBeachSettings(s: Partial<BeachSettings> | null | undefined): BeachSettings {
  const factor = Math.min(20, Math.max(1, Number.isFinite(s?.factor) ? (s!.factor as number) : DEFAULT_BEACH_SETTINGS.factor));
  const medium = Math.max(1, Math.round(s?.mediumFrom ?? DEFAULT_BEACH_SETTINGS.mediumFrom));
  const high = Math.max(medium + 1, Math.round(s?.highFrom ?? DEFAULT_BEACH_SETTINGS.highFrom));
  return { factor: Math.round(factor * 10) / 10, mediumFrom: medium, highFrom: high };
}

export function beachLevel(estimated: number, s: BeachSettings = DEFAULT_BEACH_SETTINGS): BeachLevel {
  if (estimated >= s.highFrom) return "high";
  if (estimated >= s.mediumFrom) return "medium";
  return "low";
}

export function summarizeBeach(
  entries: number,
  capacity: number | null,
  areaName: string,
  at: Date,
  settings: BeachSettings = DEFAULT_BEACH_SETTINGS,
): BeachOccupancy {
  const estimated = Math.round((entries * settings.factor) / 10) * 10;
  const fullAt = capacity && capacity > 0 ? capacity : Math.round(settings.highFrom * 1.4);
  return {
    areaName,
    entries,
    estimated,
    capacity,
    level: beachLevel(estimated, settings),
    percent: Math.min(100, Math.round((estimated / fullAt) * 100)),
    at,
    settings,
  };
}

/** Strandbad-Bereich mit Eingangs-Drehkreuzen; null, wenn es keinen gibt. */
async function findBeachArea(accountId: number) {
  const areas = await prisma.accessArea.findMany({
    where: { accountId },
    select: { id: true, name: true, personLimit: true },
    orderBy: { id: "asc" },
  });
  const area = areas.find((a) => BEACH_AREA_NAME.test(a.name));
  if (!area) return null;
  const entrances = await prisma.device.findMany({
    where: { accountId, accessIn: area.id, category: "DREHKREUZ" },
    select: { id: true },
  });
  if (entrances.length === 0) return null;
  return { ...area, entranceIds: entrances.map((d) => d.id) };
}

/**
 * Auslastung Strandbad jetzt. null, wenn es kein Strandbad mit Eingang gibt
 * oder heute noch niemand hineingegangen ist (außerhalb der Saison bleibt die
 * Karte so von selbst weg).
 */
export async function loadBeachOccupancy(accountId: number, now: Date = new Date()): Promise<BeachOccupancy | null> {
  const [area, config] = await Promise.all([
    findBeachArea(accountId),
    prisma.gamificationConfig.findUnique({
      where: { accountId },
      select: { beachGuestFactor: true, beachMediumFrom: true, beachHighFrom: true },
    }),
  ]);
  if (!area) return null;
  const base = { accountId, result: "GRANTED" as const, deviceId: { in: area.entranceIds } };
  const [today, entries] = await Promise.all([
    prisma.scan.count({ where: { ...base, scanTime: { gte: berlinDayStart(now), lte: now } } }),
    prisma.scan.count({
      where: { ...base, scanTime: { gte: new Date(now.getTime() - BEACH_WINDOW_MIN * 60_000), lte: now } },
    }),
  ]);
  if (today === 0) return null;
  const settings = normalizeBeachSettings(
    config ? { factor: config.beachGuestFactor, mediumFrom: config.beachMediumFrom, highFrom: config.beachHighFrom } : null,
  );
  return summarizeBeach(entries, area.personLimit, area.name, now, settings);
}

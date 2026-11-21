import { prisma } from "./prisma";

/**
 * Aktuelle Auslastung am Lift, gleich für Kunden-App und Verwaltung.
 *
 * Grundlage sind nur die Start-Scans (Geräte mit `countsAsStart`, heute
 * „Seilbahn A - Drehkreuz“) der letzten Stunde, als Summen ohne Namen: wie
 * viele verschiedene Fahrer gestartet sind und wie viele Starts es waren.
 * Keine Kameradaten.
 *
 * Grenzen je Mandant in `GamificationConfig` (Kunden App › Einstellungen).
 * Vorgabe 10 / 25 aus den Daten 21.08.–15.11.2026 (Fahrer je 60 Min, alle
 * 15 Min gemessen): Median 7, 90 % bis 18, 95 % bis 24, Spitze 38. „Viel los“
 * soll selten erscheinen (rund 5 % der Betriebszeit), damit niemand
 * wegbleibt (Entscheidung Aaron, 21.11.2026).
 */
export const OCCUPANCY_WINDOW_MIN = 60;

export interface OccupancyThresholds {
  /** Ab so vielen Fahrern „Gut besucht“. */
  mediumFrom: number;
  /** Ab so vielen Fahrern „Viel los“. */
  highFrom: number;
}

export const DEFAULT_OCCUPANCY_THRESHOLDS: OccupancyThresholds = { mediumFrom: 10, highFrom: 25 };

export type OccupancyLevel = "none" | "low" | "medium" | "high";

export interface RiderOccupancy {
  riders: number;
  starts: number;
  level: OccupancyLevel;
  /** Balken 0–100. */
  percent: number;
  at: Date;
  thresholds: OccupancyThresholds;
}

export const OCCUPANCY_LABEL: Record<OccupancyLevel, string> = {
  none: "Gerade ruhig",
  low: "Freie Bahn",
  medium: "Gut besucht",
  high: "Viel los",
};

/** Ungültige oder vertauschte Werte auf brauchbare Grenzen bringen. */
export function normalizeThresholds(t: Partial<OccupancyThresholds> | null | undefined): OccupancyThresholds {
  const medium = Math.max(2, Math.round(t?.mediumFrom ?? DEFAULT_OCCUPANCY_THRESHOLDS.mediumFrom));
  const high = Math.max(medium + 1, Math.round(t?.highFrom ?? DEFAULT_OCCUPANCY_THRESHOLDS.highFrom));
  return { mediumFrom: medium, highFrom: high };
}

export function occupancyLevel(riders: number, thresholds: OccupancyThresholds = DEFAULT_OCCUPANCY_THRESHOLDS): OccupancyLevel {
  if (riders <= 0) return "none";
  if (riders < thresholds.mediumFrom) return "low";
  if (riders < thresholds.highFrom) return "medium";
  return "high";
}

/** Balken: „Viel los“ beginnt bei gut zwei Dritteln, voll ist er bei 1,4 × Grenze. */
function barPercent(riders: number, thresholds: OccupancyThresholds): number {
  const fullAt = Math.max(thresholds.highFrom + 1, Math.round(thresholds.highFrom * 1.4));
  return Math.min(100, Math.round((riders / fullAt) * 100));
}

/** Verdichtet Start-Scans (ticketId darf fehlen, z. B. bei Karten ohne Ticket) zu Summen. */
export function summarizeOccupancy(
  scans: Array<{ ticketId: number | null; code?: string | null }>,
  at: Date,
  thresholds: OccupancyThresholds = DEFAULT_OCCUPANCY_THRESHOLDS,
): RiderOccupancy {
  const people = new Set<string>();
  for (const s of scans) {
    const key = s.ticketId != null ? `t${s.ticketId}` : s.code ? `c${s.code}` : null;
    if (key) people.add(key);
  }
  const riders = people.size;
  return {
    riders,
    starts: scans.length,
    level: occupancyLevel(riders, thresholds),
    percent: barPercent(riders, thresholds),
    at,
    thresholds,
  };
}

/** Auslastung der letzten Stunde für ein Konto; null, wenn kein Start-Gerät eingerichtet ist. */
export async function loadRiderOccupancy(accountId: number, now: Date = new Date()): Promise<RiderOccupancy | null> {
  const [hasStart, config] = await Promise.all([
    prisma.device.count({ where: { accountId, countsAsStart: true } }),
    prisma.gamificationConfig.findUnique({
      where: { accountId },
      select: { occupancyMediumFrom: true, occupancyHighFrom: true },
    }),
  ]);
  if (hasStart === 0) return null;
  const thresholds = normalizeThresholds(
    config ? { mediumFrom: config.occupancyMediumFrom, highFrom: config.occupancyHighFrom } : null,
  );
  const scans = await prisma.scan.findMany({
    where: {
      accountId,
      result: "GRANTED",
      scanTime: { gte: new Date(now.getTime() - OCCUPANCY_WINDOW_MIN * 60_000), lte: now },
      device: { countsAsStart: true },
    },
    select: { ticketId: true, code: true },
  });
  return summarizeOccupancy(scans, now, thresholds);
}

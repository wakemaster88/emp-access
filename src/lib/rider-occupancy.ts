import { prisma } from "./prisma";

/**
 * Aktuelle Auslastung am Lift für die Kunden-App.
 *
 * Grundlage sind nur die Start-Scans (Geräte mit `countsAsStart`, heute
 * „Seilbahn A - Drehkreuz“) der letzten Stunde, als Summen ohne Namen: wie
 * viele verschiedene Fahrer gestartet sind und wie viele Starts es waren.
 * Keine Kameradaten.
 *
 * Stufen aus den Daten 21.08.–15.11.2026 (verschiedene Fahrer je Stunde):
 * Median 7, oberes Viertel ab 12, Spitze 34.
 */
export const OCCUPANCY_WINDOW_MIN = 60;
const LEVEL_MEDIUM_FROM = 6;
const LEVEL_HIGH_FROM = 15;
/** Ab so vielen Fahrern ist der Balken voll. */
const BAR_FULL_AT = 25;

export type OccupancyLevel = "none" | "low" | "medium" | "high";

export interface RiderOccupancy {
  riders: number;
  starts: number;
  level: OccupancyLevel;
  /** Balken 0–100. */
  percent: number;
  at: Date;
}

export const OCCUPANCY_LABEL: Record<OccupancyLevel, string> = {
  none: "Gerade ruhig",
  low: "Wenig los",
  medium: "Mittel",
  high: "Viel los",
};

export function occupancyLevel(riders: number): OccupancyLevel {
  if (riders <= 0) return "none";
  if (riders < LEVEL_MEDIUM_FROM) return "low";
  if (riders < LEVEL_HIGH_FROM) return "medium";
  return "high";
}

/** Verdichtet Start-Scans (ticketId darf fehlen, z. B. bei Karten ohne Ticket) zu Summen. */
export function summarizeOccupancy(scans: Array<{ ticketId: number | null; code?: string | null }>, at: Date): RiderOccupancy {
  const people = new Set<string>();
  for (const s of scans) {
    const key = s.ticketId != null ? `t${s.ticketId}` : s.code ? `c${s.code}` : null;
    if (key) people.add(key);
  }
  const riders = people.size;
  return {
    riders,
    starts: scans.length,
    level: occupancyLevel(riders),
    percent: Math.min(100, Math.round((riders / BAR_FULL_AT) * 100)),
    at,
  };
}

/** Auslastung der letzten Stunde für ein Konto; null, wenn kein Start-Gerät eingerichtet ist. */
export async function loadRiderOccupancy(accountId: number, now: Date = new Date()): Promise<RiderOccupancy | null> {
  const hasStart = await prisma.device.count({ where: { accountId, countsAsStart: true } });
  if (hasStart === 0) return null;
  const scans = await prisma.scan.findMany({
    where: {
      accountId,
      result: "GRANTED",
      scanTime: { gte: new Date(now.getTime() - OCCUPANCY_WINDOW_MIN * 60_000), lte: now },
      device: { countsAsStart: true },
    },
    select: { ticketId: true, code: true },
  });
  return summarizeOccupancy(scans, now);
}

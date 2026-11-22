/**
 * Vereinsportal: Slots „bei Tageslicht“ (ohne Datenbank, testbar).
 *
 * Für Services mit `VereinBookableService.daylight` bietet das Portal eigene
 * Slots von Sonnenaufgang bis Sonnenuntergang am Konto-Standort an, auch wenn
 * anny an dem Tag keine Zeiten hat (Aaron, 22.11.2026: Little Bro für die
 * Cable Crew „alle Möglichkeiten, wo es hell ist“). Ein Slot beginnt frühestens
 * zur ersten vollen Stunde nach Sonnenaufgang und endet spätestens mit dem
 * Sonnenuntergang. Belegt ist ein Slot, wenn sich etwas mit ihm überschneidet.
 */

import { berlinOffset } from "@/lib/anny-availability";
import { berlinHm } from "@/lib/berlin-day";
import { getSunTimes } from "@/lib/sun";
import type { PortalSlot } from "@/lib/verein-portal-rules";

export interface DaylightSlot {
  startTime: string;
  endTime: string;
  startIso: string;
  endIso: string;
}

export interface DaylightDay {
  /** "HH:mm" Berlin, null bei fehlender Berechnung. */
  sunrise: string | null;
  sunset: string | null;
  slots: DaylightSlot[];
}

/** Zeitraum in Millisekunden, halboffen [start, end). */
export interface Interval {
  start: number;
  end: number;
}

function hm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minutesOfDay(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Slots eines Berlin-Tags zwischen Sonnenaufgang und Sonnenuntergang.
 * `slotMinutes` ist die Slot-Länge (Little Bro: 60); Starts liegen auf vollen
 * Stunden (bei kürzeren Slots auf Vielfachen der Slot-Länge).
 */
export function daylightDay(date: string, lat: number, lng: number, slotMinutes = 60): DaylightDay {
  const sun = getSunTimes(new Date(`${date}T12:00:00Z`), lat, lng);
  if (!sun.sunrise || !sun.sunset) return { sunrise: null, sunset: null, slots: [] };
  const sunrise = berlinHm(sun.sunrise);
  const sunset = berlinHm(sun.sunset);
  const length = Math.max(15, Math.min(240, Math.round(slotMinutes)));
  const step = Math.min(60, length);
  const from = Math.ceil(minutesOfDay(sunrise) / step) * step;
  const until = minutesOfDay(sunset);
  const offset = berlinOffset(date);
  const slots: DaylightSlot[] = [];
  for (let start = from; start + length <= until && start + length <= 24 * 60; start += step) {
    const startTime = hm(start);
    const endTime = hm(start + length);
    slots.push({
      startTime,
      endTime,
      startIso: new Date(`${date}T${startTime}:00${offset}`).toISOString(),
      endIso: new Date(`${date}T${endTime}:00${offset}`).toISOString(),
    });
  }
  return { sunrise, sunset, slots };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Zustand der Tageslicht-Slots aus Sicht des Vereins: eigene Buchung vor
 * belegt (die eigene Buchung liegt auch als Sperre in anny), vorbei vor frei.
 */
export function daylightSlotStates(
  slots: DaylightSlot[],
  opts: { mine: Interval[]; busy: Interval[]; now?: Date },
): PortalSlot[] {
  const now = (opts.now ?? new Date()).getTime();
  return slots.map((s) => {
    const range = { start: new Date(s.startIso).getTime(), end: new Date(s.endIso).getTime() };
    let state: PortalSlot["state"];
    if (opts.mine.some((m) => overlaps(range, m))) state = "mine";
    else if (range.start <= now) state = "past";
    else if (opts.busy.some((b) => overlaps(range, b))) state = "taken";
    else state = "free";
    return { startTime: s.startTime, endTime: s.endTime, state };
  });
}

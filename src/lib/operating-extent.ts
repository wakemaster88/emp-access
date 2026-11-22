/**
 * Betriebszeit fuer Automationen erweitern: auch zu Bahnmieten und Kursen.
 *
 * Ein Bereich wie Wasserski hat Unterprofile (Bahnmiete A, Anfaengerkurse,
 * Ferienkurs), die oft vor dem oeffentlichen Betrieb liegen. Rolltore,
 * Umkleide-Heizung oder Musik sollen dann je nach Einstellung mitlaufen:
 *
 *  - `SELF`: nur der Bereich selbst (wie bisher).
 *  - `BOOKED_SUBPROFILES`: dazu Termine, die in anny gebucht sind – die
 *    Tickets auf der anny-Ressource eines Unterprofils, beschnitten auf dessen
 *    Zeiten. Ein Ferienkurs-Ticket ueber fuenf Tage zaehlt so nur Mo–Fr 10–12.
 *  - `SUBPROFILES`: dazu alle Zeiten der Unterprofile, auch ohne Buchung.
 *
 * Reine Rechenlogik ohne Datenbank; geladen wird in `operating-extent-queries`.
 * Anzeigen (Kunden-App, Website, Kalender) nutzen das nie: dort gilt der
 * oeffentliche Betrieb.
 */

import { operatingSpansForDay, type OpeningWindow, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, DEFAULT_TIMEZONE, formatHhmm, tzMinutesOfDay } from "./tz-time";

export type OperatingExtentKind = "SELF" | "BOOKED_SUBPROFILES" | "SUBPROFILES";

export const OPERATING_EXTENTS: readonly OperatingExtentKind[] = ["SELF", "BOOKED_SUBPROFILES", "SUBPROFILES"];

export function isOperatingExtent(v: unknown): v is OperatingExtentKind {
  return typeof v === "string" && (OPERATING_EXTENTS as readonly string[]).includes(v);
}

export const OPERATING_EXTENT_LABELS: Record<OperatingExtentKind, string> = {
  SELF: "Nur Betriebszeit",
  BOOKED_SUBPROFILES: "Auch zu gebuchten Bahnmieten und Kursen",
  SUBPROFILES: "Auch zu allen Zeiten der Bahnmieten und Kurse",
};

/** Kurzform für Karten und Listen; leer bei `SELF`. */
export const OPERATING_EXTENT_SHORT: Record<OperatingExtentKind, string> = {
  SELF: "",
  BOOKED_SUBPROFILES: "+ gebuchte Mieten und Kurse",
  SUBPROFILES: "+ alle Mieten und Kurse",
};

export interface SubprofileInput {
  spec: ScheduleSpec;
  annyResourceId: string | null;
}

export interface BookingInput {
  resourceId: string;
  start: Date;
  end: Date;
}

/**
 * Gebuchte Spannen je Betriebstag von `fromYmd` bis `toYmd` (einschliesslich),
 * nur dort, wo das Unterprofil an dem Tag geoeffnet hat.
 */
export function bookedWindowsByDay(
  subs: SubprofileInput[],
  bookings: BookingInput[],
  fromYmd: string,
  toYmd: string,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): Record<string, OpeningWindow[]> {
  const out: Record<string, OpeningWindow[]> = {};
  const withResource = subs.filter((s) => s.annyResourceId);
  if (withResource.length === 0 || bookings.length === 0) return out;

  for (let ymd = fromYmd; ymd <= toYmd; ymd = addDaysToYmd(ymd, 1)) {
    for (const sub of withResource) {
      const own = bookings.filter((b) => b.resourceId === sub.annyResourceId);
      if (own.length === 0) continue;
      for (const span of operatingSpansForDay(sub.spec, ymd, tz)) {
        for (const b of own) {
          const start = Math.max(b.start.getTime(), span.from.getTime());
          const end = Math.min(b.end.getTime(), span.to.getTime());
          if (end <= start) continue;
          const open = tzMinutesOfDay(new Date(start), tz);
          const close = tzMinutesOfDay(new Date(end), tz);
          (out[ymd] ??= []).push({ opensAt: formatHhmm(open), closesAt: formatHhmm(close), overnight: close < open });
        }
      }
    }
  }
  return out;
}

/**
 * Betriebszeit eines Bereichs fuer eine Automation. Bei `SELF` oder ohne
 * Unterprofile unveraendert.
 */
export function extendSpec(
  spec: ScheduleSpec,
  extent: OperatingExtentKind,
  subs: SubprofileInput[],
  booked: Record<string, OpeningWindow[]> = {},
): ScheduleSpec {
  if (extent === "SELF" || subs.length === 0) return spec;
  if (extent === "SUBPROFILES") {
    return { ...spec, extra: { specs: subs.map((s) => s.spec), label: "Bahnmieten und Kurse" } };
  }
  return { ...spec, extra: { windows: booked, label: "Gebuchte Bahnmiete oder Kurs" } };
}

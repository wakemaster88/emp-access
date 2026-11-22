/**
 * Vereinsportal: Buchungen auf Nachbar-Ressourcen derselben Anlage.
 *
 * Little Bro bucht in anny die Bahnmiete Übungslift. Am selben Lift laufen
 * aber auch Anfängerkurse und der Ferienkurs, die in anny eigene Ressourcen
 * haben. Bisher sah das Portal nur die Bahnmiete und bot Slots an, in denen
 * am Lift schon ein Kurs lief.
 *
 * Welche Ressourcen dazugehören, steht an den Betriebszeiten-Profilen: ein
 * Unterprofil (Bahnmiete, Kurs) mit eigener anny-Ressource, das sich eine
 * Anlage mit dem Profil der gebuchten Ressource teilt. Buchungen dort zählen
 * nur innerhalb der Zeiten dieses Unterprofils: eine anny-Ressource kann
 * mehrere Anlagen bedienen (Anfängerkurse: Seilbahn B und Übungslift), und
 * ein Ferienkurs-Ticket läuft über fünf Tage, belegt aber nur 10–12 Uhr.
 *
 * Reine Logik ohne Datenbank; geladen wird in `verein-portal.ts`.
 */

import { facilityKey } from "./facility-overlap";
import { operatingSpansForDay, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, DEFAULT_TIMEZONE, tzInstant } from "./tz-time";
import type { Interval } from "./verein-daylight";

export interface RelatedProfileInput {
  annyResourceId: string | null;
  parentId: number | null;
  facilities: string[];
  spec: ScheduleSpec;
}

export interface RelatedResource {
  resourceId: string;
  /** Zeiten, in denen eine Buchung dort die Anlage belegt. */
  specs: ScheduleSpec[];
}

/**
 * Nachbar-Ressourcen von `targetResourceId`: Unterprofile mit anderer
 * anny-Ressource, die eine Anlage mit einem Profil der Ziel-Ressource teilen.
 * Leer, wenn die Ziel-Ressource an keinem Profil mit Anlage steht.
 */
export function relatedResources(profiles: RelatedProfileInput[], targetResourceId: string): RelatedResource[] {
  const own = new Set(
    profiles.filter((p) => p.annyResourceId === targetResourceId).flatMap((p) => p.facilities.map(facilityKey)),
  );
  if (own.size === 0) return [];
  const byResource = new Map<string, ScheduleSpec[]>();
  for (const p of profiles) {
    if (!p.annyResourceId || p.annyResourceId === targetResourceId || p.parentId == null) continue;
    if (!p.facilities.some((f) => own.has(facilityKey(f)))) continue;
    const list = byResource.get(p.annyResourceId) ?? [];
    list.push(p.spec);
    byResource.set(p.annyResourceId, list);
  }
  return [...byResource].map(([resourceId, specs]) => ({ resourceId, specs }));
}

/**
 * Buchungen auf die Zeiten der Unterprofile am Tag `ymd` beschneiden. Spannen
 * vom Vortag zählen mit, soweit sie über Mitternacht in den Tag reichen.
 */
export function clipToProfileSpans(
  bookings: Interval[],
  specs: ScheduleSpec[],
  ymd: string,
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): Interval[] {
  const dayStart = tzInstant(ymd, "00:00", tz)?.getTime() ?? -Infinity;
  const spans = specs.flatMap((spec) => [
    ...operatingSpansForDay(spec, addDaysToYmd(ymd, -1), tz).filter((s) => s.to.getTime() > dayStart),
    ...operatingSpansForDay(spec, ymd, tz),
  ]);
  const out: Interval[] = [];
  for (const b of bookings) {
    for (const s of spans) {
      const start = Math.max(b.start, s.from.getTime());
      const end = Math.min(b.end, s.to.getTime());
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

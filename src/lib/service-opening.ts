/**
 * Welche Tickets passen heute zu den Betriebszeiten?
 *
 * Für den Vorschlag an der Kasse: Eine Aquapark-Tageskarte soll im November
 * nicht vorgeschlagen werden, nur weil sie im Sommer um diese Uhrzeit am
 * häufigsten verkauft wurde.
 *
 * Ein Service hängt nicht direkt an einem Betriebszeit-Profil. Die Brücke ist
 * der Bereich (Ressource): Ein Profil gehört zu einem Bereich, wenn es gleich
 * heißt („Aquapark“ – „Aquapark“) oder den Bereich als Anlage belegt
 * („Wasserski“ belegt „Seilbahn A“, „Bahnmiete Übungslift“ den „Übungslift“).
 *
 * Rein und ohne Datenbank, damit es sich testen lässt; geladen wird in
 * `chips.ts`.
 */

import { openingForDay, type ScheduleSpec } from "./operating-hours";
import { areaKey } from "./public-opening";

export interface OpeningProfile {
  name: string;
  /** Anlagen, die das Profil belegt („Seilbahn A“). */
  facilities: string[];
  spec: ScheduleSpec;
}

export interface ServiceAreaNames {
  id: number;
  /** Hauptressource des Service; null = keine eindeutige. */
  mainAreaName: string | null;
  /** Alle Bereiche des Service. */
  areaNames: string[];
}

/** Profile, die zu einem Bereich gehören: gleicher Name oder als Anlage belegt. */
export function profilesForArea(areaName: string, profiles: OpeningProfile[]): OpeningProfile[] {
  const key = areaKey(areaName);
  if (!key) return [];
  return profiles.filter((p) => areaKey(p.name) === key || p.facilities.some((f) => areaKey(f) === key));
}

/**
 * Hat der Bereich am Kalendertag `ymd` geöffnet? Offen, sobald eines seiner
 * Profile an dem Tag Zeiten hat. null = kein Profil passt, also unbekannt.
 */
export function areaOpenOn(areaName: string, profiles: OpeningProfile[], ymd: string): boolean | null {
  const mine = profilesForArea(areaName, profiles);
  if (mine.length === 0) return null;
  return mine.some((p) => {
    const day = openingForDay(p.spec, ymd);
    return !day.closed && day.windows.length > 0;
  });
}

/**
 * Services, deren Bereich am Kalendertag `ymd` laut Betriebszeiten zu ist.
 *
 * Maßgeblich ist die Hauptressource; Nebenbereiche wie das Strandbad bei der
 * Wasserski-Stundenkarte zählen nicht. Ohne Hauptressource ist der Service
 * nur zu, wenn jeder seiner Bereiche nachweislich zu ist. Ein Bereich ohne
 * passendes Profil gilt nie als zu: lieber ein Vorschlag zu viel als ein
 * Ticket, das an der Kasse fehlt.
 */
export function closedServiceIds(services: ServiceAreaNames[], profiles: OpeningProfile[], ymd: string): Set<number> {
  const closed = new Set<number>();
  if (profiles.length === 0) return closed;
  const memo = new Map<string, boolean | null>();
  const openOn = (name: string) => {
    if (!memo.has(name)) memo.set(name, areaOpenOn(name, profiles, ymd));
    return memo.get(name)!;
  };
  for (const s of services) {
    const areas = s.mainAreaName ? [s.mainAreaName] : s.areaNames;
    if (areas.length > 0 && areas.every((a) => openOn(a) === false)) closed.add(s.id);
  }
  return closed;
}

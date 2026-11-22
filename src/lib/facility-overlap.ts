/**
 * Belegung der Anlagen: Profile, die dieselbe Anlage nutzen (z. B. öffentlicher
 * Betrieb und Bahnmiete A auf „Seilbahn A“), dürfen sich zeitlich nicht
 * überschneiden. Rein und ohne Datenbank, damit Seite, API und Tests dieselbe
 * Rechnung nutzen.
 *
 * Spannen gelten halboffen: 10–12 und 12–16 berühren sich, überschneiden sich
 * aber nicht.
 */
import type { ScheduleSpec } from "./operating-hours";
import { compactTime, daySegments, type DaySegment } from "./operating-calendar";
import { addDaysToYmd, formatHhmm } from "./tz-time";

export interface FacilityProfile {
  id: number;
  name: string;
  facilities: string[];
  spec: ScheduleSpec;
}

export interface ClashParty {
  id: number;
  name: string;
}

/** Eine Überschneidung an einem Tag auf einer Anlage. */
export interface FacilityClash {
  facility: string;
  date: string;
  first: ClashParty;
  second: ClashParty;
  /** Minuten ab 0:00. */
  start: number;
  end: number;
}

/** Gleiche Überschneidung an mehreren Tagen, für Liste und Fehlermeldung. */
export interface ClashGroup {
  facility: string;
  first: ClashParty;
  second: ClashParty;
  start: number;
  end: number;
  dates: string[];
}

/** Vergleichsschlüssel einer Anlage: Groß-/Kleinschreibung und Leerzeichen egal. */
export function facilityKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

/** Anlagen bereinigen: trimmen, Doppelte (gleicher Schlüssel) entfernen. */
export function cleanFacilities(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    const key = facilityKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function overlap(a: DaySegment, b: DaySegment): DaySegment | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

/**
 * Alle Überschneidungen von `from` an über `days` Tage. Je Anlage werden alle
 * Paare von Profilen verglichen, die sie belegen.
 */
export function facilityClashes(profiles: FacilityProfile[], from: string, days: number): FacilityClash[] {
  const byFacility = new Map<string, { label: string; members: FacilityProfile[] }>();
  for (const profile of profiles) {
    for (const name of cleanFacilities(profile.facilities)) {
      const key = facilityKey(name);
      const entry = byFacility.get(key) ?? { label: name, members: [] };
      entry.members.push(profile);
      byFacility.set(key, entry);
    }
  }

  const dates = Array.from({ length: days }, (_, i) => addDaysToYmd(from, i));
  // Spannen je Profil nur einmal rechnen, auch wenn es mehrere Anlagen belegt.
  const cache = new Map<number, DaySegment[][]>();
  const segmentsOf = (profile: FacilityProfile) => {
    let list = cache.get(profile.id);
    if (!list) {
      list = dates.map((d) => daySegments(profile.spec, d));
      cache.set(profile.id, list);
    }
    return list;
  };

  const out: FacilityClash[] = [];
  for (const { label, members } of byFacility.values()) {
    if (members.length < 2) continue;
    const segments = members.map(segmentsOf);
    for (let d = 0; d < dates.length; d += 1) {
      for (let a = 0; a < members.length; a += 1) {
        for (let b = a + 1; b < members.length; b += 1) {
          for (const sa of segments[a][d]) {
            for (const sb of segments[b][d]) {
              const hit = overlap(sa, sb);
              if (!hit) continue;
              out.push({
                facility: label,
                date: dates[d],
                first: { id: members[a].id, name: members[a].name },
                second: { id: members[b].id, name: members[b].name },
                start: hit.start,
                end: hit.end,
              });
            }
          }
        }
      }
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.facility.localeCompare(y.facility) || x.start - y.start);
}

/** Gleiche Anlage, gleiches Paar und gleiche Uhrzeit zusammenfassen; nach erstem Tag sortiert. */
export function groupClashes(clashes: FacilityClash[]): ClashGroup[] {
  const groups = new Map<string, ClashGroup>();
  for (const c of clashes) {
    const [first, second] = c.first.id <= c.second.id ? [c.first, c.second] : [c.second, c.first];
    const key = `${facilityKey(c.facility)}|${first.id}|${second.id}|${c.start}|${c.end}`;
    const group = groups.get(key) ?? { facility: c.facility, first, second, start: c.start, end: c.end, dates: [] };
    group.dates.push(c.date);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.facility.localeCompare(b.facility));
}

function shortDate(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.`;
}

/** "12–16 Uhr" aus Minuten. */
export function clashTimeLabel(start: number, end: number): string {
  return `${compactTime(formatHhmm(start))}–${end >= 24 * 60 ? "24" : compactTime(formatHhmm(end))} Uhr`;
}

/** "03.04., 01.05., 14.05. und 2 weitere" */
export function clashDatesLabel(dates: string[], max = 4): string {
  const shown = dates.slice(0, max).map(shortDate).join(", ");
  const rest = dates.length - max;
  return rest > 0 ? `${shown} und ${rest} ${rest === 1 ? "weiterer Tag" : "weitere Tage"}` : shown;
}

/** Ein Satz je Gruppe, z. B. für die Fehlermeldung beim Speichern. */
export function describeClashGroup(group: ClashGroup): string {
  return `${group.facility}: ${group.first.name} und ${group.second.name} ${clashTimeLabel(group.start, group.end)} am ${clashDatesLabel(group.dates)}`;
}

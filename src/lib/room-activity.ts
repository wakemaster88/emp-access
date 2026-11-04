/**
 * Personen-Aktivitaet je Raum aus den Kameras des Raums: Personen-Ereignisse
 * heute nach Stunde, ob gerade jemand da ist, und welche hinterlegten
 * Personen die Gesichtserkennung gesehen hat.
 *
 * Eine Kopfzahl liefern die Kameras nicht (Reolink meldet nur "Person ja/nein").
 * "Gerade jemand da" heisst: ein Personen-Ereignis laeuft noch oder endete vor
 * kurzem.
 */

import { tzInstant, tzMinutesOfDay, tzYmd } from "@/lib/tz-time";

/** So lange nach dem Ende eines Ereignisses gilt der Raum noch als belegt. */
export const PRESENCE_GRACE_MS = 3 * 60_000;
/** Ein offenes Ereignis, das aelter ist, gilt als haengengeblieben. */
export const OPEN_EVENT_MAX_MS = 30 * 60_000;

export interface RoomActivityPerson {
  name: string;
  listType: string | null;
  count: number;
  lastAt: string;
}

export interface RoomActivity {
  /** Personen-Ereignisse je Stunde des heutigen Tages (Zeitzone des Mandanten). */
  hours: number[];
  total: number;
  present: boolean;
  lastAt: string | null;
  people: RoomActivityPerson[];
  /** Sichtungen ohne Zuordnung zu einer hinterlegten Person. */
  unknown: number;
  /** Davon Ereignisse von Bewegungsmeldern (statt Kamera). */
  motion: number;
}

export interface ActivityMotion {
  roomId: number;
  at: Date;
}

/** So lange nach einer Bewegung gilt der Raum als besetzt (Takt 5 Min.). */
export const MOTION_PRESENCE_MS = 6 * 60_000;

export interface ActivityEvent {
  roomId: number;
  startedAt: Date;
  endedAt: Date | null;
}

export interface ActivitySighting {
  roomId: number;
  seenAt: Date;
  person: { name: string; listType: string | null } | null;
}

/** Beginn des heutigen Tages in der Zeitzone. */
export function dayStart(now: Date, tz: string): Date {
  return tzInstant(tzYmd(now, tz), "00:00", tz) ?? new Date(now.getTime() - 24 * 3600_000);
}

export function buildRoomActivity(
  events: ActivityEvent[],
  sightings: ActivitySighting[],
  now: Date,
  tz: string,
  motions: ActivityMotion[] = [],
): Map<number, RoomActivity> {
  const out = new Map<number, RoomActivity>();
  const get = (roomId: number) => {
    let a = out.get(roomId);
    if (!a) {
      a = { hours: Array(24).fill(0), total: 0, present: false, lastAt: null, people: [], unknown: 0, motion: 0 };
      out.set(roomId, a);
    }
    return a;
  };
  const t = now.getTime();
  for (const e of events) {
    const a = get(e.roomId);
    const hour = Math.min(23, Math.floor(tzMinutesOfDay(e.startedAt, tz) / 60));
    a.hours[hour]++;
    a.total++;
    const iso = e.startedAt.toISOString();
    if (!a.lastAt || iso > a.lastAt) a.lastAt = iso;
    const open = e.endedAt === null && t - e.startedAt.getTime() < OPEN_EVENT_MAX_MS;
    const recent = e.endedAt !== null && t - e.endedAt.getTime() < PRESENCE_GRACE_MS;
    if (open || recent) a.present = true;
  }
  for (const m of motions) {
    const a = get(m.roomId);
    a.hours[Math.min(23, Math.floor(tzMinutesOfDay(m.at, tz) / 60))]++;
    a.total++;
    a.motion++;
    const iso = m.at.toISOString();
    if (!a.lastAt || iso > a.lastAt) a.lastAt = iso;
    if (t - m.at.getTime() < MOTION_PRESENCE_MS) a.present = true;
  }
  for (const s of sightings) {
    const a = get(s.roomId);
    if (!s.person) {
      a.unknown++;
      continue;
    }
    const iso = s.seenAt.toISOString();
    const hit = a.people.find((p) => p.name === s.person!.name);
    if (hit) {
      hit.count++;
      if (iso > hit.lastAt) hit.lastAt = iso;
    } else {
      a.people.push({ name: s.person.name, listType: s.person.listType, count: 1, lastAt: iso });
    }
  }
  for (const a of out.values()) a.people.sort((x, y) => (x.lastAt < y.lastAt ? 1 : -1));
  return out;
}

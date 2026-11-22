/**
 * Betriebszeit fuer Automationen laden, auf Wunsch samt Bahnmieten und Kursen
 * (Unterprofile) bzw. deren gebuchten Terminen. Rechenlogik in
 * `operating-extent.ts`.
 *
 * Gebuchte Termine kommen aus den anny-Tickets der Unterprofil-Ressourcen
 * (`Ticket.annyResourceId`), nur gueltige oder eingeloeste. Geladen wird ein
 * Fenster von gestern bis drei Tage voraus: genug fuer Ausloeser rund um heute
 * und fuer den naechsten Wechsel, den ein Musikabspieler kennen muss.
 */

import type { ScheduleSpec } from "./operating-hours";
import { bookedWindowsByDay, extendSpec, type OperatingExtentKind } from "./operating-extent";
import { scheduleSpecInclude, toScheduleSpec, type ScheduleRecord } from "./operating-queries";
import type { TenantDb } from "./prisma";
import { DEFAULT_TIMEZONE, addDaysToYmd, tzYmd } from "./tz-time";

const DAY_MS = 86_400_000;

/**
 * Betriebszeit `scheduleId` fuer eine Automation mit Reichweite `extent`.
 * null, wenn es das Profil nicht gibt.
 */
export async function loadExtendedSpec(
  db: TenantDb,
  accountId: number,
  scheduleId: number,
  extent: OperatingExtentKind,
  now: Date = new Date(),
  tz: string | null | undefined = DEFAULT_TIMEZONE,
): Promise<ScheduleSpec | null> {
  const record = await db.operatingSchedule.findFirst({
    where: { id: scheduleId, accountId },
    include: {
      ...scheduleSpecInclude,
      children: { include: scheduleSpecInclude, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (!record) return null;
  const spec = toScheduleSpec(record);
  if (extent === "SELF" || record.children.length === 0) return spec;

  const subs = record.children.map((c) => ({ spec: toScheduleSpec(c), annyResourceId: c.annyResourceId }));
  if (extent === "SUBPROFILES") return extendSpec(spec, extent, subs);

  const resourceIds = [...new Set(subs.map((s) => s.annyResourceId).filter((x): x is string => !!x))];
  if (resourceIds.length === 0) return spec;
  const from = new Date(now.getTime() - 2 * DAY_MS);
  const to = new Date(now.getTime() + 4 * DAY_MS);
  const tickets = await db.ticket.findMany({
    where: {
      accountId,
      annyResourceId: { in: resourceIds },
      status: { notIn: ["CANCELED", "INVALID", "PAUSED"] },
      startDate: { lt: to },
      endDate: { gt: from },
    },
    select: { annyResourceId: true, startDate: true, endDate: true },
  });
  const bookings = tickets
    .filter((t) => t.annyResourceId && t.startDate && t.endDate)
    .map((t) => ({ resourceId: t.annyResourceId!, start: t.startDate!, end: t.endDate! }));
  const today = tzYmd(now, tz);
  const booked = bookedWindowsByDay(subs, bookings, addDaysToYmd(today, -1), addDaysToYmd(today, 3), tz);
  return extendSpec(spec, extent, subs, booked);
}

/**
 * Wie `loadExtendedSpec`, aber je Profil und Reichweite nur einmal geladen –
 * fuer Takte, die viele Regeln oder Raeume nacheinander pruefen.
 */
export function extendedSpecCache(db: TenantDb, now: Date = new Date()) {
  const cache = new Map<string, Promise<ScheduleSpec | null>>();
  return (accountId: number, scheduleId: number, extent: OperatingExtentKind, tz?: string | null) => {
    const key = `${accountId}:${scheduleId}:${extent}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = loadExtendedSpec(db, accountId, scheduleId, extent, now, tz);
      cache.set(key, hit);
    }
    return hit;
  };
}

/** So viel braucht `zoneMusicSpec` von einer Zone. */
export interface ZoneMusicInput {
  musicExtent: OperatingExtentKind;
  keyRoom?: { operatingScheduleId: number | null; operatingSchedule: ScheduleRecord | null } | null;
}

/**
 * Betriebszeit, nach der eine Zone mit Musik-Automatik „Betriebszeit“ spielt:
 * die ihres Raums, bei `musicExtent` samt Bahnmieten und Kursen.
 */
export async function zoneMusicSpec(
  db: TenantDb,
  accountId: number,
  zone: ZoneMusicInput,
  now: Date = new Date(),
  tz?: string | null,
): Promise<ScheduleSpec | null> {
  const record = zone.keyRoom?.operatingSchedule ?? null;
  if (!record) return null;
  const scheduleId = zone.keyRoom?.operatingScheduleId ?? null;
  if (zone.musicExtent === "SELF" || scheduleId == null) return toScheduleSpec(record);
  return (await loadExtendedSpec(db, accountId, scheduleId, zone.musicExtent, now, tz)) ?? toScheduleSpec(record);
}

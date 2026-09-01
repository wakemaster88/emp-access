/**
 * Laden und Schreiben von Betriebszeiten. Liegt hier und nicht in den
 * Route-Dateien, weil `route.ts` nur HTTP-Handler exportieren darf.
 *
 * Saisons, Perioden und Ausnahmetage haben keinen eigenen `accountId`: sie
 * haengen per Cascade am Profil, das die Mandantengrenze zieht. Jeder Zugriff
 * geht deshalb ueber das Profil, dessen Zugehoerigkeit vorher geprueft wird.
 */

import type { ScheduleSpec } from "./operating-hours";
import type { TenantDb } from "./prisma";

export const scheduleInclude = {
  seasons: {
    include: { periods: { orderBy: { weekday: "asc" as const } } },
    orderBy: { sortOrder: "asc" as const },
  },
  exceptions: { orderBy: { date: "asc" as const } },
  _count: { select: { rooms: true } },
};

/** Form, die `scheduleInclude` liefert – so viel, wie die Auswertung braucht. */
export interface ScheduleRecord {
  name: string;
  seasons: Array<{
    name: string;
    startMmDd: string;
    endMmDd: string;
    sortOrder: number;
    periods: Array<{ weekday: number; opensAt: string; closesAt: string }>;
  }>;
  exceptions: Array<{
    date: string;
    closed: boolean;
    opensAt: string | null;
    closesAt: string | null;
    note?: string | null;
  }>;
}

/** Datensatz in die Form bringen, die `operating-hours.ts` auswertet. */
export function toScheduleSpec(record: ScheduleRecord): ScheduleSpec {
  return {
    name: record.name,
    seasons: record.seasons.map((s) => ({
      name: s.name,
      startMmDd: s.startMmDd,
      endMmDd: s.endMmDd,
      sortOrder: s.sortOrder,
      periods: s.periods.map((p) => ({
        weekday: p.weekday,
        opensAt: p.opensAt,
        closesAt: p.closesAt,
      })),
    })),
    exceptions: record.exceptions.map((e) => ({
      date: e.date,
      closed: e.closed,
      opensAt: e.opensAt,
      closesAt: e.closesAt,
      note: e.note ?? null,
    })),
  };
}

export interface SeasonInput {
  name: string;
  startMmDd: string;
  endMmDd: string;
  sortOrder?: number;
  periods: Array<{ weekday: number; opensAt: string; closesAt: string }>;
}

export interface ExceptionInput {
  date: string;
  closed: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
  note?: string | null;
}

/**
 * Saisons eines Profils vollersetzen. Bewusst loeschen und neu anlegen statt
 * einzeln abzugleichen: die Oberflaeche schickt den kompletten Stand, und die
 * Datenmengen sind winzig (eine Handvoll Saisons mit je hoechstens 70 Zeilen).
 */
export async function replaceSeasons(
  db: TenantDb,
  scheduleId: number,
  seasons: SeasonInput[],
): Promise<void> {
  await db.operatingSeason.deleteMany({ where: { scheduleId } });
  for (const [index, season] of seasons.entries()) {
    await db.operatingSeason.create({
      data: {
        scheduleId,
        name: season.name.trim(),
        startMmDd: season.startMmDd,
        endMmDd: season.endMmDd,
        sortOrder: season.sortOrder ?? index,
        periods: {
          create: season.periods.map((p) => ({
            weekday: p.weekday,
            opensAt: p.opensAt,
            closesAt: p.closesAt,
          })),
        },
      },
      select: { id: true },
    });
  }
}

/** Ausnahmetage vollersetzen. Doppelte Daten fallen dabei heraus. */
export async function replaceExceptions(
  db: TenantDb,
  scheduleId: number,
  exceptions: ExceptionInput[],
): Promise<void> {
  await db.operatingException.deleteMany({ where: { scheduleId } });
  const seen = new Set<string>();
  const rows = exceptions
    .filter((e) => (seen.has(e.date) ? false : (seen.add(e.date), true)))
    .map((e) => ({
      scheduleId,
      date: e.date,
      closed: e.closed,
      opensAt: e.closed ? null : e.opensAt ?? null,
      closesAt: e.closed ? null : e.closesAt ?? null,
      note: e.note?.trim() || null,
    }));
  if (rows.length > 0) await db.operatingException.createMany({ data: rows });
}

/**
 * Sorgt dafuer, dass hoechstens ein Profil je Mandant als Vorbelegung gilt.
 * Ohne das haetten neue Raeume zwei Kandidaten und die Anzeige waere beliebig.
 */
export async function clearOtherDefaults(
  db: TenantDb,
  accountId: number,
  keepId: number,
): Promise<void> {
  await db.operatingSchedule.updateMany({
    where: { accountId, isDefault: true, id: { not: keepId } },
    data: { isDefault: false },
  });
}

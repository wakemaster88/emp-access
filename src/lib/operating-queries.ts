/**
 * Laden und Schreiben von Betriebszeiten. Liegt hier und nicht in den
 * Route-Dateien, weil `route.ts` nur HTTP-Handler exportieren darf.
 *
 * Saisons, Perioden und Ausnahmetage haben keinen eigenen `accountId`: sie
 * haengen per Cascade am Profil, das die Mandantengrenze zieht. Jeder Zugriff
 * geht deshalb ueber das Profil, dessen Zugehoerigkeit vorher geprueft wird.
 */

import type { OperatingRoleKind } from "./operating-role";
import {
  cleanFacilities,
  describeClashGroup,
  facilityClashes,
  groupClashes,
  type ClashGroup,
  type FacilityProfile,
} from "./facility-overlap";
import type { ScheduleSpec } from "./operating-hours";
import type { TenantDb } from "./prisma";
import { DEFAULT_TIMEZONE, tzYmd } from "./tz-time";

export const scheduleInclude = {
  seasons: {
    include: { periods: { orderBy: { weekday: "asc" as const } } },
    orderBy: { sortOrder: "asc" as const },
  },
  exceptions: { orderBy: { date: "asc" as const } },
  _count: { select: { rooms: true } },
};

/**
 * Nur das, was `toScheduleSpec` zur Auswertung braucht – fuer Regel-Engine,
 * Audio-Zeitplaene und Seiten, die "geoeffnet bis" anzeigen.
 */
export const scheduleSpecInclude = {
  seasons: { include: { periods: true }, orderBy: { sortOrder: "asc" as const } },
  exceptions: true,
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

/**
 * Jede Verwendung (Lift, Shop, Strandbad) gilt je Mandant für höchstens ein
 * Profil: wer sie neu setzt, nimmt sie den anderen.
 */
export async function clearOtherRoles(
  db: TenantDb,
  accountId: number,
  keepId: number,
  role: OperatingRoleKind,
): Promise<void> {
  await db.operatingSchedule.updateMany({
    where: { accountId, role, id: { not: keepId } },
    data: { role: null },
  });
}

// ─── Unterprofile und Anlagen ───────────────────────────────────────────────

/** Saisons aus der Eingabe in die Auswertungsform bringen (wie `replaceSeasons` speichert). */
export function seasonInputsToSpec(seasons: SeasonInput[]): ScheduleSpec["seasons"] {
  return seasons.map((s, index) => ({
    name: s.name.trim(),
    startMmDd: s.startMmDd,
    endMmDd: s.endMmDd,
    sortOrder: s.sortOrder ?? index,
    periods: s.periods.map((p) => ({ weekday: p.weekday, opensAt: p.opensAt, closesAt: p.closesAt })),
  }));
}

/** Ausnahmen aus der Eingabe in die Auswertungsform bringen (wie `replaceExceptions` speichert). */
export function exceptionInputsToSpec(exceptions: ExceptionInput[]): ScheduleSpec["exceptions"] {
  const seen = new Set<string>();
  return exceptions
    .filter((e) => (seen.has(e.date) ? false : (seen.add(e.date), true)))
    .map((e) => ({
      date: e.date,
      closed: e.closed,
      opensAt: e.closed ? null : (e.opensAt ?? null),
      closesAt: e.closed ? null : (e.closesAt ?? null),
      note: e.note?.trim() || null,
    }));
}

/**
 * Zuordnung zu einem Oberprofil pruefen: gleicher Mandant, nur eine Ebene,
 * nicht sich selbst. Liefert eine Fehlermeldung oder null.
 */
export async function checkParent(
  db: TenantDb,
  accountId: number,
  scheduleId: number | null,
  parentId: number | null,
): Promise<string | null> {
  if (parentId == null) return null;
  if (parentId === scheduleId) return "Ein Profil kann nicht unter sich selbst stehen";
  const parent = await db.operatingSchedule.findFirst({
    where: { id: parentId, accountId },
    select: { parentId: true },
  });
  if (!parent) return "Oberprofil nicht gefunden";
  if (parent.parentId != null) return "Unterprofile haben keine eigenen Unterprofile";
  if (scheduleId != null) {
    const children = await db.operatingSchedule.count({ where: { accountId, parentId: scheduleId } });
    if (children > 0) return "Dieses Profil hat selbst Unterprofile und kann nicht darunter stehen";
  }
  return null;
}

/** So weit voraus wird die Belegung der Anlagen geprueft (wie der Abgleich). */
export const CLASH_DAYS = 365;

/**
 * Ueberschneidungen, an denen `candidate` beteiligt waere, ab heute. Die
 * uebrigen Profile kommen aus der Datenbank; `candidate` ersetzt dort das
 * gespeicherte Profil gleicher ID (beim Anlegen: id -1).
 */
export async function clashesForCandidate(
  db: TenantDb,
  accountId: number,
  candidate: FacilityProfile,
  now: Date = new Date(),
): Promise<ClashGroup[]> {
  if (cleanFacilities(candidate.facilities).length === 0) return [];
  const [others, account] = await Promise.all([
    db.operatingSchedule.findMany({
      where: { accountId, id: { not: candidate.id }, facilities: { isEmpty: false } },
      include: scheduleSpecInclude,
    }),
    db.account.findUnique({ where: { id: accountId }, select: { timezone: true } }),
  ]);
  const profiles: FacilityProfile[] = [
    candidate,
    ...others.map((s) => ({
      id: s.id,
      name: s.name,
      facilities: s.facilities,
      shared: s.sharedTime,
      spec: toScheduleSpec(s),
    })),
  ];
  const from = tzYmd(now, account?.timezone || DEFAULT_TIMEZONE);
  // Geteilte Zeit ist gewollt und hält das Speichern nicht auf.
  const clashes = facilityClashes(profiles, from, CLASH_DAYS).filter(
    (c) => !c.shared && (c.first.id === candidate.id || c.second.id === candidate.id),
  );
  return groupClashes(clashes);
}

/** Fehlermeldung fuer das Speichern, hoechstens drei Gruppen ausgeschrieben. */
export function clashError(groups: ClashGroup[]): string {
  const lines = groups.slice(0, 3).map(describeClashGroup);
  const more = groups.length > 3 ? ` (und ${groups.length - 3} weitere)` : "";
  return `Überschneidung auf der Anlage – ${lines.join("; ")}${more}. Bitte Zeiten anpassen.`;
}

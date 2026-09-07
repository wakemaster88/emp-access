/**
 * Auswertung der Audio-Zeitplaene. Laeuft minuetlich per Cron: faellige
 * Eintraege des aktuellen Fensters ausfuehren, `lastRunAt` als
 * Idempotenz-Guard setzen.
 *
 * Ein Zeitplan bemisst seinen Zeitpunkt entweder an einer festen Uhrzeit
 * oder an der Betriebszeit (Betriebsbeginn/-ende mit Versatz). Welche
 * Betriebszeit gilt, entscheidet – wie bei den Raumregeln – zuerst der
 * Zeitplan selbst, sonst der Raum der jeweiligen Zielzone. Zonen in
 * verschiedenen Raeumen koennen deshalb zu verschiedenen Zeiten dran sein;
 * der Lauf gruppiert sie nach Betriebszeit.
 */
import { prisma, tenantClient, type TenantDb } from "@/lib/prisma";
import {
  SCHEDULE_WINDOW_MINUTES,
  ensureAnnouncementTrack,
  isScheduleDue,
  parseZoneIds,
  playlistPayload,
  queueAnnouncement,
  queueZoneCommand,
} from "@/lib/audio";
import {
  dueOperatingOccurrence,
  isOperatingAt,
  type ScheduleSpec,
} from "@/lib/operating-hours";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";

const DEFAULT_TIMEZONE = "Europe/Berlin";

export type AudioTickResult = {
  checked: number;
  triggered: number;
  errors: string[];
};

/** Zielzone samt der Betriebszeit ihres Raums. */
interface ZoneTarget {
  id: number;
  name: string;
  deviceId: number | null;
  scheduleId: number | null;
  spec: ScheduleSpec | null;
}

async function loadZones(db: TenantDb, accountId: number): Promise<ZoneTarget[]> {
  const zones = await db.audioZone.findMany({
    where: { accountId, isActive: true },
    select: {
      id: true,
      name: true,
      deviceId: true,
      keyRoom: { select: { operatingSchedule: { include: scheduleSpecInclude } } },
    },
    orderBy: { sortOrder: "asc" },
  });
  return zones.map((zone) => {
    const schedule = zone.keyRoom?.operatingSchedule ?? null;
    return {
      id: zone.id,
      name: zone.name,
      deviceId: zone.deviceId,
      scheduleId: schedule?.id ?? null,
      spec: schedule ? toScheduleSpec(schedule) : null,
    };
  });
}

interface TimedSchedule {
  trigger: "TIME" | "OPENING" | "CLOSING";
  timeOfDay: string | null;
  offsetMinutes: number;
  daysOfWeek: number;
  operating: "ANY" | "OPEN" | "CLOSED";
  lastRunAt: Date | null;
  explicitSpec: ScheduleSpec | null;
}

/**
 * Welche Zielzonen sind fuer diesen Zeitplan jetzt dran? Reine Rechnung ohne
 * Datenbank, damit sie sich pruefen laesst.
 *
 * Bei Betriebsbeginn/-ende bekommt jede Betriebszeit ihren eigenen Zeitpunkt.
 * Der `lastRunAt`-Guard vergleicht mit dem Zeitpunkt selbst, nicht mit dem
 * Tag: so laeuft ein Zeitplan fuer zwei Raeume mit Beginn 10:00 und 12:00 an
 * beiden Zeitpunkten, aber an keinem doppelt.
 */
export function dueZonesForSchedule(
  schedule: TimedSchedule,
  targets: ZoneTarget[],
  now: Date,
  timeZone: string,
): ZoneTarget[] {
  const specFor = (zone: ZoneTarget) => schedule.explicitSpec ?? zone.spec;

  let due: ZoneTarget[] = [];
  if (schedule.trigger === "TIME") {
    if (
      schedule.timeOfDay &&
      isScheduleDue(
        { timeOfDay: schedule.timeOfDay, daysOfWeek: schedule.daysOfWeek, lastRunAt: schedule.lastRunAt },
        now,
        timeZone,
      )
    ) {
      due = targets;
    }
  } else {
    const trigger = {
      kind: schedule.trigger === "OPENING" ? ("open" as const) : ("close" as const),
      offsetMinutes: schedule.offsetMinutes,
      daysOfWeek: schedule.daysOfWeek,
    };
    const window = { beforeMs: 0, afterMs: SCHEDULE_WINDOW_MINUTES * 60_000 };

    // Gruppen nach Betriebszeit; die ausdrueckliche des Zeitplans gilt fuer alle.
    const groups = new Map<string, { spec: ScheduleSpec; zones: ZoneTarget[] }>();
    for (const zone of targets) {
      const spec = specFor(zone);
      if (!spec) continue; // ohne Betriebszeit gibt es keinen Beginn und kein Ende
      const key = schedule.explicitSpec ? "explicit" : `room-${zone.scheduleId}`;
      const group = groups.get(key) ?? { spec, zones: [] };
      group.zones.push(zone);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const occurrence = dueOperatingOccurrence(group.spec, trigger, now, timeZone, window);
      if (!occurrence) continue;
      if (schedule.lastRunAt && schedule.lastRunAt.getTime() >= occurrence.at.getTime()) continue;
      due.push(...group.zones);
    }
  }

  if (schedule.operating !== "ANY") {
    due = due.filter((zone) => {
      const open = isOperatingAt(specFor(zone), now, timeZone);
      return schedule.operating === "OPEN" ? open : !open;
    });
  }
  return due;
}

export async function runAudioScheduleTick(now = new Date()): Promise<AudioTickResult> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, timezone: true },
  });

  const result: AudioTickResult = { checked: 0, triggered: 0, errors: [] };

  for (const account of accounts) {
    const timeZone = account.timezone || DEFAULT_TIMEZONE;
    const db = tenantClient(account.id);

    const schedules = await db.audioSchedule.findMany({
      where: { accountId: account.id, isActive: true },
      include: {
        announcement: {
          include: { track: { select: { id: true, url: true, durationSec: true } } },
        },
        operatingSchedule: { include: scheduleSpecInclude },
      },
    });
    if (schedules.length === 0) continue;

    // Einmal je Mandant laden, nicht je Zeitplan.
    const zones = await loadZones(db, account.id);

    for (const schedule of schedules) {
      result.checked++;

      try {
        const wanted = parseZoneIds(schedule.zoneIds);
        const targets = wanted.length > 0 ? zones.filter((z) => wanted.includes(z.id)) : zones;
        const due = dueZonesForSchedule(
          {
            trigger: schedule.trigger,
            timeOfDay: schedule.timeOfDay,
            offsetMinutes: schedule.offsetMinutes,
            daysOfWeek: schedule.daysOfWeek,
            operating: schedule.operating,
            lastRunAt: schedule.lastRunAt,
            explicitSpec: schedule.operatingSchedule
              ? toScheduleSpec(schedule.operatingSchedule)
              : null,
          },
          targets,
          now,
          timeZone,
        );
        if (due.length === 0) continue;

        const triggerKind = schedule.trigger === "TIME" ? "SCHEDULE" : `SCHEDULE:${schedule.trigger}`;

        if (schedule.action === "ANNOUNCE" && schedule.announcement) {
          const track = await ensureAnnouncementTrack(db, account.id, schedule.announcement);
          await queueAnnouncement(
            db,
            account.id,
            { ...schedule.announcement, track },
            due,
            triggerKind,
          );
        } else if (schedule.action === "PLAY" && schedule.playlistId) {
          const payload = await playlistPayload(db, schedule.playlistId);
          if (payload) {
            await queueZoneCommand(
              db,
              account.id,
              due,
              "PLAY",
              { kind: "PLAYLIST", ...(payload as object) },
              triggerKind,
            );
          }
        } else if (schedule.action === "STOP") {
          await queueZoneCommand(db, account.id, due, "STOP", null, triggerKind);
        } else if (schedule.action === "VOLUME" && schedule.volume != null) {
          await queueZoneCommand(
            db,
            account.id,
            due,
            "VOLUME",
            { volume: schedule.volume },
            triggerKind,
          );
          await db.audioZone.updateMany({
            where: { id: { in: due.map((z) => z.id) } },
            data: { volume: schedule.volume },
          });
        } else {
          continue;
        }

        await db.audioSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now },
        });
        result.triggered++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Zeitplan ${schedule.id}: ${message}`);
      }
    }
  }

  return result;
}

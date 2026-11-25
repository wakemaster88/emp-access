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
  TTS_RENDER_TIMEOUT_CRON_MS,
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
import { controlAudioZone } from "@/lib/audio-integration";

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
    // Ein Fehler bei einem Mandanten haelt die uebrigen nicht auf.
    try {
      await runAccountSchedules(account, now, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Konto ${account.id}: ${message}`);
    }
  }

  return result;
}

/** Gibt es fuer den Zeitplan eine ausfuehrbare Aktion (wie die Zweige unten)? */
function hasScheduleAction(schedule: {
  action: string;
  announcement: unknown;
  playlistId: number | null;
  volume: number | null;
}): boolean {
  if (schedule.action === "ANNOUNCE") return !!schedule.announcement;
  if (schedule.action === "PLAY" || schedule.action === "STOP") return true;
  if (schedule.action === "VOLUME") return schedule.volume != null;
  return false;
}

async function runAccountSchedules(
  account: { id: number; timezone: string | null },
  now: Date,
  result: AudioTickResult,
): Promise<void> {
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
  if (schedules.length === 0) return;

  // Einmal je Mandant laden, nicht je Zeitplan.
  const zones = await loadZones(db, account.id);

  for (const schedule of schedules) {
    result.checked++;

    let claimed = false;
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
      if (!hasScheduleAction(schedule)) continue;

      // Langsame, wiederholbare Vorbereitung (TTS-Rendern, Playlist laden)
      // laeuft vor dem Belegen. Endet die Function dabei, bleibt lastRunAt
      // unveraendert und der naechste Minutenlauf holt den Zeitplan nach.
      let track: Awaited<ReturnType<typeof ensureAnnouncementTrack>> | null = null;
      let payload: Awaited<ReturnType<typeof playlistPayload>> = null;
      if (schedule.action === "ANNOUNCE" && schedule.announcement) {
        const spec = schedule.operatingSchedule
          ? toScheduleSpec(schedule.operatingSchedule)
          : due.find((z) => z.spec)?.spec ?? null;
        track = await ensureAnnouncementTrack(db, account.id, schedule.announcement, {
          now,
          timezone: timeZone,
          schedule: spec,
        }, TTS_RENDER_TIMEOUT_CRON_MS);
      } else if (schedule.action === "PLAY" && schedule.playlistId) {
        payload = await playlistPayload(db, account.id, schedule.playlistId);
      }

      // Zeitplan vor dem Einreihen fuer diesen Lauf belegen: nur wenn lastRunAt
      // noch den gelesenen Wert hat. Ein paralleler Lauf (z. B. wenn ein
      // Minutenlauf laenger dauert) findet dann keinen offenen Zeitplan mehr.
      const claim = await db.audioSchedule.updateMany({
        where: { id: schedule.id, lastRunAt: schedule.lastRunAt },
        data: { lastRunAt: now },
      });
      if (claim.count !== 1) continue;
      claimed = true;

      const triggerKind = schedule.trigger === "TIME" ? "SCHEDULE" : `SCHEDULE:${schedule.trigger}`;

      if (schedule.action === "ANNOUNCE" && schedule.announcement && track) {
        await queueAnnouncement(
          db,
          account.id,
          { ...schedule.announcement, track },
          due,
          triggerKind,
        );
      } else if (schedule.action === "PLAY" && schedule.playlistId) {
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
      } else if (schedule.action === "PLAY") {
        // Ohne Playlist: Vorgabe der Zone (Webradio/Playlist, wie im Raum eingestellt).
        const zones = await db.audioZone.findMany({
          where: { accountId: account.id, id: { in: due.map((z) => z.id) } },
          select: { id: true, volume: true, defaultSource: true, streamId: true, streamUrl: true, playlistId: true },
        });
        for (const zone of zones) {
          await controlAudioZone(db, account.id, zone, {
            action: "PLAY",
            persistStreamUrl: false,
            fromSchedule: true,
            triggerKind,
          });
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
      }

      result.triggered++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Zeitplan ${schedule.id}: ${message}`);
      // Wie bisher: nach einem Fehler gilt der Zeitplan als nicht gelaufen
      // und wird beim naechsten Lauf erneut versucht.
      if (claimed) {
        await db.audioSchedule
          .updateMany({
            where: { id: schedule.id, lastRunAt: now },
            data: { lastRunAt: schedule.lastRunAt },
          })
          .catch(() => {});
      }
    }
  }
}

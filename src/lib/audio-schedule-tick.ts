/**
 * Auswertung der Audio-Zeitpläne. Läuft alle 5 Minuten per Cron und arbeitet
 * nach dem gleichen Muster wie die Shelly-Automationen: fällige Einträge des
 * aktuellen Fensters ausführen, `lastRunAt` als Idempotenz-Guard setzen.
 */
import { prisma, tenantClient } from "@/lib/prisma";
import {
  ensureAnnouncementTrack,
  matchesDayOfWeek,
  parseZoneIds,
  playlistPayload,
  queueAnnouncement,
  queueZoneCommand,
  resolveTargetZones,
} from "@/lib/audio";

/** Toleranzfenster in Minuten – muss mindestens dem Cron-Intervall entsprechen. */
const WINDOW_MINUTES = 5;

const DEFAULT_TIMEZONE = "Europe/Berlin";

function localTimeParts(date: Date, timeZone: string): { time: string; minutes: number } {
  const formatted = new Intl.DateTimeFormat("de-DE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const [hour, minute] = formatted.split(":").map(Number);
  return { time: formatted, minutes: hour * 60 + minute };
}

function toMinutes(timeOfDay: string): number {
  const [hour, minute] = timeOfDay.split(":").map(Number);
  return hour * 60 + minute;
}

export type AudioTickResult = {
  checked: number;
  triggered: number;
  errors: string[];
};

export async function runAudioScheduleTick(now = new Date()): Promise<AudioTickResult> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, timezone: true },
  });

  const result: AudioTickResult = { checked: 0, triggered: 0, errors: [] };

  for (const account of accounts) {
    const timeZone = account.timezone || DEFAULT_TIMEZONE;
    const { minutes: nowMinutes } = localTimeParts(now, timeZone);
    const db = tenantClient(account.id);

    const schedules = await db.audioSchedule.findMany({
      where: { accountId: account.id, isActive: true },
      include: {
        announcement: {
          include: { track: { select: { id: true, url: true, durationSec: true } } },
        },
      },
    });

    for (const schedule of schedules) {
      result.checked++;

      if (!matchesDayOfWeek(schedule.daysOfWeek, now, timeZone)) continue;

      const due = toMinutes(schedule.timeOfDay);
      // Fenster [due, due + WINDOW): verhindert, dass ein Eintrag verpasst wird,
      // wenn der Cron ein paar Sekunden später läuft.
      if (nowMinutes < due || nowMinutes >= due + WINDOW_MINUTES) continue;

      // Idempotenz: pro Tag nur einmal auslösen.
      if (schedule.lastRunAt) {
        const sinceLastRun = now.getTime() - schedule.lastRunAt.getTime();
        if (sinceLastRun < WINDOW_MINUTES * 60 * 1000 * 2) continue;
      }

      try {
        const zones = await resolveTargetZones(db, account.id, parseZoneIds(schedule.zoneIds));
        if (zones.length === 0) continue;

        if (schedule.action === "ANNOUNCE" && schedule.announcement) {
          const track = await ensureAnnouncementTrack(db, account.id, schedule.announcement);
          await queueAnnouncement(
            db,
            account.id,
            { ...schedule.announcement, track },
            zones,
            "SCHEDULE"
          );
        } else if (schedule.action === "PLAY" && schedule.playlistId) {
          const payload = await playlistPayload(db, schedule.playlistId);
          if (payload) {
            await queueZoneCommand(
              db,
              account.id,
              zones,
              "PLAY",
              { kind: "PLAYLIST", ...(payload as object) },
              "SCHEDULE"
            );
          }
        } else if (schedule.action === "STOP") {
          await queueZoneCommand(db, account.id, zones, "STOP", null, "SCHEDULE");
        } else if (schedule.action === "VOLUME" && schedule.volume != null) {
          await queueZoneCommand(
            db,
            account.id,
            zones,
            "VOLUME",
            { volume: schedule.volume },
            "SCHEDULE"
          );
          await db.audioZone.updateMany({
            where: { id: { in: zones.map((z) => z.id) } },
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

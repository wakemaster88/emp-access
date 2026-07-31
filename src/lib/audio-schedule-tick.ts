/**
 * Auswertung der Audio-Zeitpläne. Läuft minütlich per Cron und arbeitet nach
 * dem gleichen Muster wie die Shelly-Automationen: fällige Einträge des
 * aktuellen Fensters ausführen, `lastRunAt` als Idempotenz-Guard setzen.
 */
import { prisma, tenantClient } from "@/lib/prisma";
import {
  ensureAnnouncementTrack,
  isScheduleDue,
  parseZoneIds,
  playlistPayload,
  queueAnnouncement,
  queueZoneCommand,
  resolveTargetZones,
} from "@/lib/audio";

const DEFAULT_TIMEZONE = "Europe/Berlin";

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

      if (!isScheduleDue(schedule, now, timeZone)) continue;

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

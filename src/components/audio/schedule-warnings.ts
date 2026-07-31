/**
 * Warum ein Zeitplan nichts abspielen wird.
 *
 * Ein Zeitplan kann völlig richtig aussehen und trotzdem stumm bleiben: die
 * Zielzone hat keinen Abspieler, der Pi ist aus, die Playlist wurde gelöscht
 * oder der Termin fällt in die Ruhezeit der Zone. Auffallen würde das erst zur
 * Uhrzeit selbst – und dann merkt es niemand, weil ja nichts passiert. Darum
 * stehen die Gründe an der Karte.
 */
import { isQuietTime } from "@/lib/audio-constants";
import type { AnnouncementRow, PlaylistRow, ScheduleRow, ZoneRow } from "./types";

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" und ");
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

/** Zielzonen eines Zeitplans – leeres `zoneIds` bedeutet alle aktiven Zonen. */
export function scheduleTargetZones(schedule: ScheduleRow, zones: ZoneRow[]): ZoneRow[] {
  const active = zones.filter((zone) => zone.isActive);
  if (schedule.zoneIds.length === 0) return active;
  return active.filter((zone) => schedule.zoneIds.includes(zone.id));
}

export function scheduleWarnings(
  schedule: ScheduleRow,
  zones: ZoneRow[],
  playlists: PlaylistRow[],
  announcements: AnnouncementRow[]
): string[] {
  const warnings: string[] = [];
  const targets = scheduleTargetZones(schedule, zones);

  if (targets.length === 0) {
    warnings.push(
      schedule.zoneIds.length === 0
        ? "Keine aktive Zone vorhanden – der Termin läuft ins Leere."
        : "Die ausgewählten Zonen gibt es nicht mehr oder sie sind abgeschaltet."
    );
    return warnings;
  }

  const withoutPlayer = targets.filter((zone) => zone.deviceId === null);
  if (withoutPlayer.length > 0) {
    warnings.push(
      `Ohne Abspieler: ${joinNames(withoutPlayer.map((z) => z.name))}. Der Befehl bleibt im Verlauf für immer auf „wartet“ stehen.`
    );
  }

  const offline = targets.filter((zone) => zone.deviceId !== null && !zone.deviceOnline);
  if (offline.length > 0) {
    warnings.push(
      `Abspieler meldet sich nicht: ${joinNames(offline.map((z) => z.name))}. Bis zum Termin muss er wieder online sein.`
    );
  }

  if (schedule.action === "ANNOUNCE") {
    const announcement = announcements.find((a) => a.id === schedule.announcementId);
    if (announcement && !announcement.isTemplate) {
      warnings.push(
        `„${announcement.name}“ ist keine Vorlage mehr. Der Termin läuft weiter, in der Auswahl steht die Durchsage aber nicht.`
      );
    }
  }

  if (schedule.action === "PLAY") {
    // playlistId wird beim Löschen der Playlist auf null gesetzt, der Zeitplan
    // bleibt bestehen und tut dann nichts mehr.
    if (schedule.playlistId === null) {
      warnings.push("Die Playlist wurde gelöscht. Ohne neue Auswahl startet nichts.");
    } else {
      const playlist = playlists.find((p) => p.id === schedule.playlistId);
      if (playlist && playlist.trackIds.length === 0) {
        warnings.push(`Die Playlist „${playlist.name}“ ist leer.`);
      }
    }

    const quiet = targets.filter((zone) =>
      isQuietTime(zone.quietFrom, zone.quietTo, schedule.timeOfDay)
    );
    if (quiet.length > 0) {
      warnings.push(
        `Fällt in die Ruhezeit von ${joinNames(quiet.map((z) => z.name))} – dort bleibt die Musik aus.`
      );
    }
  }

  return warnings;
}

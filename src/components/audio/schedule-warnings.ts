/**
 * Warum ein Zeitplan nichts abspielen wird.
 *
 * Ein Zeitplan kann völlig richtig aussehen und trotzdem stumm bleiben: die
 * Zielzone hat keinen Abspieler, der Pi ist aus, die Playlist wurde gelöscht
 * oder der Termin liegt außerhalb der Betriebszeit einer Zone, die Musik nur
 * dann spielt. Auffallen würde das erst zur Uhrzeit selbst – und dann merkt
 * es niemand, weil ja nichts passiert. Darum stehen die Gründe an der Karte.
 */
import { SCHEDULE_WINDOW_MINUTES } from "@/lib/audio-constants";
import { isWithinOperatingSpan } from "@/lib/operating-hours";
import { DEFAULT_TIMEZONE, addDaysToYmd, tzInstant, tzYmd, weekdayBitOfYmd } from "@/lib/tz-time";
import type {
  AnnouncementRow,
  OperatingScheduleOption,
  PlaylistRow,
  ScheduleRow,
  ZoneRow,
} from "./types";

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

/**
 * Betriebszeiten, nach denen sich der Zeitplan richtet: die ausdrücklich
 * gewählte, sonst je Zielzone die des Raums. `unresolved` sind Zielzonen ohne
 * Betriebszeit – dort gibt es weder Betriebsbeginn noch -ende.
 */
export function scheduleOperatingSpecs(
  schedule: ScheduleRow,
  zones: ZoneRow[],
  options: OperatingScheduleOption[]
): { specs: OperatingScheduleOption[]; unresolved: ZoneRow[] } {
  const targets = scheduleTargetZones(schedule, zones);
  if (schedule.operatingScheduleId != null) {
    const explicit = options.find((o) => o.id === schedule.operatingScheduleId);
    return { specs: explicit ? [explicit] : [], unresolved: explicit ? [] : targets };
  }
  const specs = new Map<number, OperatingScheduleOption>();
  const unresolved: ZoneRow[] = [];
  for (const zone of targets) {
    const option =
      zone.operatingScheduleId != null
        ? options.find((o) => o.id === zone.operatingScheduleId)
        : undefined;
    if (option) specs.set(option.id, option);
    else unresolved.push(zone);
  }
  return { specs: [...specs.values()], unresolved };
}

/**
 * Betriebstag des nächsten Termins eines Uhrzeit-Zeitplans, oder null ohne
 * Wochentag. Dieselbe Rechnung wie `nextScheduleRunLabel`, nur als Datum.
 */
function nextTimedRunYmd(
  schedule: ScheduleRow,
  now: Date,
  timeZone: string
): string | null {
  if (!schedule.timeOfDay) return null;
  const today = tzYmd(now, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const ymd = addDaysToYmd(today, offset);
    if (((schedule.daysOfWeek >> weekdayBitOfYmd(ymd)) & 1) === 0) continue;
    if (offset === 0) {
      const at = tzInstant(ymd, schedule.timeOfDay, timeZone);
      if (at && now.getTime() >= at.getTime() + SCHEDULE_WINDOW_MINUTES * 60_000) continue;
    }
    return ymd;
  }
  return null;
}

/**
 * Zielzonen, die Musik nur zur Betriebszeit spielen und bei denen der Termin
 * außerhalb liegt. Bei fester Uhrzeit zählt der nächste Termin; bei
 * Betriebsbeginn/-ende der Vergleich der Versätze – sofern dieselbe
 * Betriebszeit gilt, sonst lässt sich nichts sagen.
 */
export function zonesOutsideMusicWindow(
  schedule: ScheduleRow,
  targets: ZoneRow[],
  options: OperatingScheduleOption[],
  timeZone: string,
  now = new Date()
): ZoneRow[] {
  return targets.filter((zone) => {
    // Ohne Betriebszeit läuft die Musik jederzeit – der Schalter wirkt nicht.
    if (!zone.musicOperating || zone.operatingScheduleId == null) return false;
    const offsets = { openMinutes: zone.musicOpenOffset, closeMinutes: zone.musicCloseOffset };

    if (schedule.trigger === "TIME") {
      const spec = options.find((o) => o.id === zone.operatingScheduleId);
      const ymd = nextTimedRunYmd(schedule, now, timeZone);
      const at = spec && ymd && schedule.timeOfDay ? tzInstant(ymd, schedule.timeOfDay, timeZone) : null;
      return !!at && !isWithinOperatingSpan(spec, at, timeZone, offsets);
    }

    if (schedule.operatingScheduleId != null && schedule.operatingScheduleId !== zone.operatingScheduleId) {
      return false;
    }
    return schedule.trigger === "OPENING"
      ? schedule.offsetMinutes < zone.musicOpenOffset
      : schedule.offsetMinutes >= zone.musicCloseOffset;
  });
}

export function scheduleWarnings(
  schedule: ScheduleRow,
  zones: ZoneRow[],
  playlists: PlaylistRow[],
  announcements: AnnouncementRow[],
  operatingSchedules: OperatingScheduleOption[] = [],
  timeZone: string = DEFAULT_TIMEZONE
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

  if (schedule.trigger !== "TIME") {
    const { unresolved } = scheduleOperatingSpecs(schedule, zones, operatingSchedules);
    if (unresolved.length > 0) {
      const kind = schedule.trigger === "OPENING" ? "Betriebsbeginn" : "Betriebsende";
      warnings.push(
        unresolved.length === targets.length
          ? `Keine Betriebszeit zuständig – ohne sie gibt es keinen ${kind}. Zone einem Raum mit Betriebszeit zuordnen oder hier eine Betriebszeit wählen.`
          : `Ohne Betriebszeit: ${joinNames(unresolved.map((z) => z.name))}. Dort bleibt der Termin aus.`
      );
    }
  }

  if (schedule.operating === "CLOSED") {
    const { unresolved } = scheduleOperatingSpecs(schedule, zones, operatingSchedules);
    if (unresolved.length > 0) {
      warnings.push(
        `${joinNames(unresolved.map((z) => z.name))} ${unresolved.length === 1 ? "hat" : "haben"} keine Betriebszeit und ${unresolved.length === 1 ? "gilt" : "gelten"} als dauerhaft geöffnet – „nur außerhalb der Betriebszeit“ schließt sie aus.`
      );
    }
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

    const outside = zonesOutsideMusicWindow(schedule, targets, operatingSchedules, timeZone);
    if (outside.length > 0) {
      warnings.push(
        `${schedule.trigger === "TIME" ? "Der nächste Termin liegt" : "Liegt"} außerhalb der Betriebszeit von ${joinNames(outside.map((z) => z.name))} (Musik nur zur Betriebszeit) – dort bleibt die Musik aus.`
      );
    }
  }

  return warnings;
}

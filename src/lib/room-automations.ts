/**
 * Ablaeufe eines Raums fuer die Raumkarte: Regeln des Raums und Audio-
 * Zeitplaene seiner Zonen in einer gemeinsamen, lesbaren Form ("30 Min. vor
 * Öffnung → Rolltor Verleih öffnen") samt naechstem Lauf.
 *
 * Reine Funktionen ohne Datenbank, damit Seite und Tests sie teilen.
 */

import { operatingOccurrenceForDay, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, DEFAULT_TIMEZONE, tzInstant, tzYmd, weekdayBitOfYmd } from "./tz-time";

/** So weit sucht der naechste Lauf voraus; Saisonbetrieb hat lange Pausen. */
const LOOKAHEAD_DAYS = 60;

export interface AutomationInput {
  key: string;
  kind: "rule" | "audio";
  name: string;
  isActive: boolean;
  /** RuleTrigger bzw. AudioScheduleTrigger. */
  trigger: string;
  offsetMinutes: number;
  timeOfDay: string | null;
  daysOfWeek: number;
  /** Zustaendige Betriebszeit (eigene oder die des Raums). */
  schedule: ScheduleSpec | null;
  /** Bereits beschriftete Aktionen. */
  actions: string[];
  lastRunAt: Date | null;
}

export interface RoomAutomation {
  key: string;
  kind: "rule" | "audio";
  name: string;
  isActive: boolean;
  /** "30 Min. vor Öffnung", "zum Betriebsende", "täglich 19:00". */
  when: string;
  /** "open" | "close" | "time" | "event" – fuer Symbol und Farbe. */
  anchor: "open" | "close" | "time" | "event";
  actions: string[];
  /** ISO-Zeitpunkt des naechsten Laufs; null = ereignisgesteuert oder keiner absehbar. */
  nextAt: string | null;
  lastRunAt: string | null;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function daysLabel(mask: number): string {
  if (mask === 127) return "täglich";
  if (mask === 31) return "Mo–Fr";
  if (mask === 96) return "Sa+So";
  return WEEKDAYS.filter((_, i) => ((mask >> i) & 1) === 1).join(", ");
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}:${String(m).padStart(2, "0")} Std.` : `${h} Std.`;
}

/** Ein kurzer Satz, wann der Ablauf greift. */
export function whenLabel(trigger: string, offsetMinutes: number, timeOfDay: string | null, daysOfWeek: number): string {
  const days = daysOfWeek === 127 ? "" : ` · ${daysLabel(daysOfWeek)}`;
  switch (trigger) {
    case "OPENING":
    case "CLOSING": {
      const base = trigger === "OPENING" ? "Öffnung" : "Betriebsende";
      if (offsetMinutes === 0) return `${trigger === "OPENING" ? "zur" : "zum"} ${base}${days}`;
      const rel = offsetMinutes < 0 ? "vor" : "nach";
      return `${durationLabel(Math.abs(offsetMinutes))} ${rel} ${base}${days}`;
    }
    case "TIME":
      return `${daysLabel(daysOfWeek)} ${timeOfDay ?? "–"} Uhr`;
    case "SUNRISE":
    case "SUNSET": {
      const base = trigger === "SUNRISE" ? "Sonnenaufgang" : "Sonnenuntergang";
      if (offsetMinutes === 0) return `bei ${base}${days}`;
      return `${durationLabel(Math.abs(offsetMinutes))} ${offsetMinutes < 0 ? "vor" : "nach"} ${base}${days}`;
    }
    case "MOTION":
      return "bei Bewegung";
    case "IDLE":
      return "bei Ruhe im Raum";
    case "DEVICE_SWITCHED":
      return "wenn ein Gerät schaltet";
    case "SCAN":
      return "bei Zutritt";
    default:
      return trigger;
  }
}

function anchorOf(trigger: string): RoomAutomation["anchor"] {
  if (trigger === "OPENING") return "open";
  if (trigger === "CLOSING") return "close";
  if (trigger === "TIME") return "time";
  return "event";
}

/** Naechster Lauf ab `now`, oder null (ereignisgesteuert, inaktiv oder nichts in Sicht). */
export function nextAutomationRun(input: AutomationInput, now: Date, tz: string = DEFAULT_TIMEZONE): Date | null {
  if (!input.isActive) return null;
  const today = tzYmd(now, tz);
  const nowMs = now.getTime();

  if (input.trigger === "TIME") {
    if (!input.timeOfDay) return null;
    for (let d = 0; d <= 7; d++) {
      const ymd = addDaysToYmd(today, d);
      if (((input.daysOfWeek >> weekdayBitOfYmd(ymd)) & 1) !== 1) continue;
      const at = tzInstant(ymd, input.timeOfDay, tz);
      if (at && at.getTime() >= nowMs) return at;
    }
    return null;
  }

  if (input.trigger === "OPENING" || input.trigger === "CLOSING") {
    if (!input.schedule) return null;
    const trigger = {
      kind: input.trigger === "OPENING" ? ("open" as const) : ("close" as const),
      offsetMinutes: input.offsetMinutes,
      daysOfWeek: input.daysOfWeek,
    };
    // Ab gestern: ein Betriebsende nach Mitternacht gehoert zum Vortag.
    for (let d = -1; d <= LOOKAHEAD_DAYS; d++) {
      const occ = operatingOccurrenceForDay(input.schedule, trigger, addDaysToYmd(today, d), tz);
      if (occ && occ.at.getTime() >= nowMs) return occ.at;
    }
    return null;
  }

  return null;
}

export function buildRoomAutomation(input: AutomationInput, now: Date, tz: string = DEFAULT_TIMEZONE): RoomAutomation {
  const next = nextAutomationRun(input, now, tz);
  return {
    key: input.key,
    kind: input.kind,
    name: input.name,
    isActive: input.isActive,
    when: whenLabel(input.trigger, input.offsetMinutes, input.timeOfDay, input.daysOfWeek),
    anchor: anchorOf(input.trigger),
    actions: input.actions,
    nextAt: next ? next.toISOString() : null,
    lastRunAt: input.lastRunAt ? input.lastRunAt.toISOString() : null,
  };
}

/** Aktive mit naechstem Lauf zuerst (nach Zeit), dann ereignisgesteuerte, dann pausierte. */
export function sortAutomations(list: RoomAutomation[]): RoomAutomation[] {
  const rank = (a: RoomAutomation) => (!a.isActive ? 2 : a.nextAt ? 0 : 1);
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.nextAt && b.nextAt) return a.nextAt.localeCompare(b.nextAt);
    return a.name.localeCompare(b.name, "de");
  });
}

const AUDIO_VERBS: Record<string, string> = {
  PLAY: "Musik starten",
  STOP: "Musik stoppen",
  ANNOUNCE: "Durchsage",
  VOLUME: "Lautstärke",
};

/** "Insel: Musik starten", "Restaurant: Durchsage „Feierabend“", "Insel: Lautstärke 40 %". */
export function audioActionLabel(
  action: string,
  zones: string[],
  extra: { announcement?: string | null; playlist?: string | null; volume?: number | null },
): string {
  const where = zones.length ? `${zones.join(", ")}: ` : "";
  if (action === "ANNOUNCE" && extra.announcement) return `${where}Durchsage „${extra.announcement}“`;
  if (action === "PLAY" && extra.playlist) return `${where}Playlist „${extra.playlist}“`;
  if (action === "VOLUME" && extra.volume != null) return `${where}Lautstärke ${extra.volume} %`;
  return `${where}${AUDIO_VERBS[action] ?? action}`;
}

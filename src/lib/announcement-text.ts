/**
 * Platzhalter in Ansagetexten. Statt "es ist 20 Uhr" steht im Text
 * "es ist {uhrzeit}" und wird beim Abspielen aus der echten Zeit bzw. der
 * Betriebszeit des Tages gefuellt. So stimmt die Durchsage auch, wenn sich die
 * Betriebszeit aendert.
 *
 *   {uhrzeit}   aktuelle Uhrzeit            "15:50 Uhr", "12 Uhr"
 *   {oeffnung}  Beginn der heutigen Betriebszeit
 *   {schluss}   Ende der heutigen Betriebszeit
 *   {minuten}   Minuten bis Betriebsende    "10"
 *
 * Umlaute und Gross-/Kleinschreibung sind egal ({Öffnung} geht auch).
 */

import { openingForDay, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, DEFAULT_TIMEZONE, formatHhmm, parseHhmm, tzInstant, tzMinutesOfDay, tzYmd } from "./tz-time";

export const ANNOUNCEMENT_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{uhrzeit}", label: "aktuelle Uhrzeit" },
  { token: "{oeffnung}", label: "Beginn der Betriebszeit heute" },
  { token: "{schluss}", label: "Ende der Betriebszeit heute" },
  { token: "{minuten}", label: "Minuten bis Betriebsende" },
];

const TOKEN_RE = /\{\s*(uhrzeit|oeffnung|öffnung|schluss|minuten)\s*\}/gi;

export function hasPlaceholders(text: string | null | undefined): boolean {
  if (!text) return false;
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

/** Sprechbare Uhrzeit: "12 Uhr", "15:50 Uhr". */
export function spokenTime(minutesOfDay: number): string {
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} Uhr` : `${formatHhmm(m)} Uhr`;
}

export interface AnnouncementContext {
  now: Date;
  timezone?: string | null;
  /** Betriebszeit, nach der sich {oeffnung}/{schluss}/{minuten} richten. */
  schedule: ScheduleSpec | null;
}

/** Erstes Öffnen und letztes Schließen am Betriebstag `ymd`, oder null. */
function dayBounds(schedule: ScheduleSpec, ymd: string): { opensAt: string; closesAt: string } | null {
  const day = openingForDay(schedule, ymd);
  if (day.closed || day.windows.length === 0) return null;
  return { opensAt: day.windows[0].opensAt, closesAt: day.windows[day.windows.length - 1].closesAt };
}

/**
 * Setzt die Platzhalter ein. Ist heute geschlossen, gelten die Zeiten des
 * naechsten Betriebstags. Was sich nicht bestimmen laesst (keine
 * Betriebszeit), faellt sauber weg, statt als "{schluss}" vorgelesen zu werden.
 */
export function resolveAnnouncementText(text: string, ctx: AnnouncementContext): string {
  const tz = ctx.timezone || DEFAULT_TIMEZONE;
  const today = tzYmd(ctx.now, tz);
  let bounds: { ymd: string; opensAt: string; closesAt: string } | null = null;
  if (ctx.schedule) {
    for (let d = 0; d <= 14 && !bounds; d++) {
      const ymd = addDaysToYmd(today, d);
      const b = dayBounds(ctx.schedule, ymd);
      if (b) bounds = { ymd, ...b };
    }
  }

  const minutesToClose = (): string => {
    if (!bounds) return "";
    let closeAt = tzInstant(bounds.ymd, bounds.closesAt, tz);
    // Ende nach Mitternacht gehoert zum Folgetag.
    if (closeAt && (parseHhmm(bounds.closesAt) ?? 0) <= (parseHhmm(bounds.opensAt) ?? 0)) {
      closeAt = tzInstant(addDaysToYmd(bounds.ymd, 1), bounds.closesAt, tz);
    }
    if (!closeAt) return "";
    return String(Math.max(0, Math.round((closeAt.getTime() - ctx.now.getTime()) / 60_000)));
  };

  const resolved = text.replace(TOKEN_RE, (_, raw: string) => {
    switch (raw.toLowerCase()) {
      case "uhrzeit":
        return spokenTime(tzMinutesOfDay(ctx.now, tz));
      case "oeffnung":
      case "öffnung":
        return bounds ? spokenTime(parseHhmm(bounds.opensAt) ?? 0) : "";
      case "schluss":
        return bounds ? spokenTime(parseHhmm(bounds.closesAt) ?? 0) : "";
      case "minuten":
        return minutesToClose();
      default:
        return "";
    }
  });
  return resolved.replace(/[ \t]{2,}/g, " ").trim();
}

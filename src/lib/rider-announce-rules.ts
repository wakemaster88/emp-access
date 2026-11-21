/**
 * Regeln für den Push an alle Kunden bei einem neuen Angebot oder einer neuen
 * Challenge. Ohne Datenbank, damit die Tests sie direkt prüfen können.
 */
import { challengeConditionText, offerVisible, type ChallengeKind, type GamiMetric } from "./gamification";
import { currentHoliday, HOLIDAY_BY_KEY, type HolidayShowKind } from "./holidays";

/** Gesendet wird nur tagsüber (Berlin), sonst wartet der Push bis zum Morgen. */
export const ANNOUNCE_FROM_HOUR = 9;
export const ANNOUNCE_UNTIL_HOUR = 21;

/** Einträge mit „TEST:“ am Anfang sind Probedaten und gehen nie an Kunden. */
export function isTestTitle(title: string): boolean {
  return /^\s*test\s*:/i.test(title);
}

export function inAnnounceHours(hour: number): boolean {
  return hour >= ANNOUNCE_FROM_HOUR && hour < ANNOUNCE_UNTIL_HOUR;
}

export interface AnnounceState {
  pushPlanned: boolean;
  pushedAt: Date | null;
}

/** Warum (noch) nichts gesendet wird; `null` heißt: jetzt senden. */
export type AnnounceBlock = "not-planned" | "sent" | "test" | "off" | "not-yet" | "over" | "night";

export interface OfferAnnounceInput extends AnnounceState {
  title: string;
  active: boolean;
  fromYmd: string | null;
  toYmd: string | null;
}

export interface ChallengeAnnounceInput extends AnnounceState {
  name: string;
  active: boolean;
  startYmd: string;
  endYmd: string;
}

function common(e: AnnounceState & { active: boolean }, title: string): AnnounceBlock | null {
  if (e.pushedAt) return "sent";
  if (!e.pushPlanned) return "not-planned";
  if (isTestTitle(title)) return "test";
  if (!e.active) return "off";
  return null;
}

/** Ein Angebot wird gemeldet, sobald Kunden es in der App sehen. */
export function offerAnnounceBlock(o: OfferAnnounceInput, todayYmd: string, hour: number): AnnounceBlock | null {
  const base = common(o, o.title);
  if (base) return base;
  if (o.toYmd && todayYmd > o.toYmd) return "over";
  if (!offerVisible({ active: o.active, fromYmd: o.fromYmd, toYmd: o.toYmd }, todayYmd)) return "not-yet";
  return inAnnounceHours(hour) ? null : "night";
}

/**
 * Eine Challenge erscheint in der App schon vor dem Start („startet am …“),
 * deshalb wird sie sofort gemeldet, solange sie nicht vorbei ist.
 */
export function challengeAnnounceBlock(c: ChallengeAnnounceInput, todayYmd: string, hour: number): AnnounceBlock | null {
  const base = common(c, c.name);
  if (base) return base;
  if (todayYmd > c.endYmd) return "over";
  return inAnnounceHours(hour) ? null : "night";
}

/** "18:00" → "18 Uhr", "18:30" → "18:30 Uhr". */
export function clockText(hm: string): string {
  return hm.endsWith(":00") ? `${Number(hm.slice(0, 2))} Uhr` : `${hm} Uhr`;
}

/** Satzende ergänzen, damit angehängte Hinweise nicht am Text kleben. */
function sentence(t: string): string {
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function dm(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}.`;
}

export interface AnnounceText {
  title: string;
  body: string;
}

export function offerPushText(o: { title: string; text: string | null; toYmd: string | null }): AnnounceText {
  const body = sentence(o.text?.trim() || "Schau in der App vorbei.");
  return {
    title: `Neues Angebot: ${o.title}`,
    body: o.toYmd ? `${body} Gilt bis ${dm(o.toYmd)}` : body,
  };
}

export function challengePushText(
  c: {
    name: string;
    description: string | null;
    kind: ChallengeKind;
    metric: GamiMetric;
    threshold: number | null;
    topCount: number | null;
    startYmd: string;
    endYmd: string;
    /** Uhrzeit am Endtag ("HH:MM"), sonst null. */
    endTime?: string | null;
    voucherLabel: string | null;
  },
  todayYmd: string,
): AnnounceText {
  const parts: string[] = [sentence(c.description?.trim() || challengeConditionText(c))];
  if (c.voucherLabel) parts.push(`Gewinn: ${sentence(c.voucherLabel)}`);
  const until = c.endTime ? ` bis ${clockText(c.endTime)}` : "";
  if (c.endTime && c.startYmd === c.endYmd) parts.push(`Am ${dm(c.startYmd)}${until}`);
  else if (todayYmd < c.startYmd) parts.push(`Startet am ${dm(c.startYmd)}`);
  else parts.push(`Läuft bis ${dm(c.endYmd)}${c.endTime ? `, ${clockText(c.endTime)}` : ""}`);
  return { title: `Neue Challenge: ${c.name}`, body: parts.join(" ") };
}

/** Kurzer Grund für die Verwaltung, warum der Push noch wartet. */
export function announceBlockText(block: AnnounceBlock): string {
  switch (block) {
    case "test":
      return "Titel beginnt mit „TEST:“, es geht kein Push raus.";
    case "off":
      return "Ausgeschaltet, der Push geht raus, sobald es aktiv ist.";
    case "not-yet":
      return "Geht raus, sobald es in der App sichtbar ist.";
    case "over":
      return "Zeitraum ist vorbei, es geht kein Push mehr raus.";
    case "night":
      return `Geht um ${ANNOUNCE_FROM_HOUR} Uhr raus, nachts senden wir nicht.`;
    case "sent":
      return "Push ist schon gesendet.";
    case "not-planned":
      return "Kein Push.";
  }
}

export interface HolidayAnnounceInput {
  key: string;
  active: boolean;
  daysBefore: number;
  pushPlanned: boolean;
  /** Jahr des Feiertags, für das der Push zuletzt ging. */
  pushedYear: number | null;
}

/**
 * Ein Feiertag wird jedes Jahr einmal gemeldet, sobald er in der App
 * erscheint (erster Tag von „Schon vorher zeigen“), tagsüber.
 */
export function holidayAnnounceBlock(h: HolidayAnnounceInput, todayYmd: string, hour: number): AnnounceBlock | null {
  if (!h.pushPlanned) return "not-planned";
  if (!h.active) return "off";
  const hit = currentHoliday([h], todayYmd);
  if (!hit) return "not-yet";
  if (h.pushedYear === hit.year) return "sent";
  return inAnnounceHours(hour) ? null : "night";
}

export function holidayPushText(h: {
  key: string;
  show: HolidayShowKind;
  title: string | null;
  text: string | null;
  voucherLabel: string | null;
}): AnnounceText {
  const title = h.title?.trim() || HOLIDAY_BY_KEY.get(h.key)?.greeting || "Schönen Feiertag";
  const text = h.text?.trim() ? sentence(h.text.trim()) : "";
  if (h.show === "VOUCHER" && h.voucherLabel) {
    const gift = `Mit Abo wartet ein Geschenk in der App: ${sentence(h.voucherLabel.trim())}`;
    return { title, body: text ? `${text} ${gift}` : gift };
  }
  return { title, body: text || "Schau in der App vorbei." };
}

/**
 * „Tor offen halten“ (doorbird.ts): Regeln ohne Netz und ohne Uhr.
 *
 * Der Hub meldet jeden Impuls an die Cloud (/api/hub/cameras/[id]/door-hold).
 * Die Antwort nennt den Sollzustand (`until`: Endzeitpunkt oder null). Damit
 * endet ein Offenhalten, das die Cloud beendet hat, auch dann nach dem
 * naechsten Impuls, wenn der Auftrag dazu den Hub nie erreicht hat; eine
 * Verlaengerung kommt ohne eigenen Auftrag an. Ohne Antwort oder ohne das
 * Feld (aeltere Cloud) laeuft der lokale Takt bis zum lokal bekannten Ende.
 */

/**
 * Obergrenze eines Offenhaltens ab dem Moment, in dem es gesetzt wird. Die
 * Cloud setzt sie beim Schreiben des Sollzustands durch
 * (DOOR_HOLD_MAX_MINUTES in src/lib/door-hold.ts: parseDoorHoldMinutes fuer
 * die Oberflaeche, doorHoldUntilError fuer POST /api/hub/tasks).
 */
export const HOLD_MAX_MS = 12 * 60 * 60_000;

/**
 * Spielraum fuer unterschiedlich gehende Uhren von Cloud und Hub: Die Cloud
 * rechnet die Obergrenze mit ihrer Uhr.
 */
export const HOLD_CLOCK_SLACK_MS = 5 * 60_000;

export type HoldAfterReport =
  | { action: "keep" }
  | { action: "stop" }
  | { action: "adopt"; until: number };

/**
 * Was nach der Antwort auf eine Impuls-Meldung gilt. `lokalUntil` ist das
 * lokale Ende beim Absenden der Meldung, `cloudUntil` das Feld `until` der
 * Antwort, so wie es im JSON stand (undefined: keine Antwort oder kein Feld).
 *
 * - null oder ein Zeitpunkt, der schon vorbei ist: Offenhalten beenden.
 * - ein anderer Zeitpunkt in der Zukunft: ihn uebernehmen (verlaengern oder
 *   verkuerzen), aber nie einen jenseits der Obergrenze.
 * - sonst (gleich, fehlt, kein lesbarer Zeitpunkt): weitermachen wie bisher.
 */
export function afterReport(lokalUntil: number, cloudUntil: unknown, jetzt: number): HoldAfterReport {
  if (cloudUntil === null) return { action: "stop" };
  if (typeof cloudUntil !== "string" || !cloudUntil) return { action: "keep" };
  const until = Date.parse(cloudUntil);
  if (!Number.isFinite(until)) return { action: "keep" };
  if (until <= jetzt) return { action: "stop" };
  if (until === lokalUntil) return { action: "keep" };
  if (until - jetzt > HOLD_MAX_MS + HOLD_CLOCK_SLACK_MS) return { action: "keep" };
  return { action: "adopt", until };
}

/**
 * Die Antwort gilt nur fuer genau das Offenhalten, zu dem der Impuls gehoerte,
 * und nur, wenn sich dessen Ende waehrend der Meldung nicht geaendert hat.
 * Sonst kann sie vor einem Auftrag gelesen worden sein, den der Hub schon
 * ausgefuehrt hat: Eine spaete null-Antwort beendete ein eben neu gestartetes
 * Offenhalten, ein altes Ende kuerzte eine eben angekommene Verlaengerung.
 */
export function reportApplies(s: { sameHold: boolean; untilAtSend: number; untilNow: number }): boolean {
  return s.sameHold && s.untilAtSend === s.untilNow;
}

/** Wartezeiten bis zur 1., 2. und 3. Wiederholung eines gescheiterten Impulses. */
export function retryDelays(): number[] {
  return [3_000, 8_000, 20_000];
}

/**
 * Wartezeit bis zur naechsten Wiederholung nach `failStreak` gescheiterten
 * Impulsen in Folge (seit dem letzten gelungenen). Nach der dritten
 * Wiederholung null: Es geht im normalen Takt weiter, bis ein Impuls gelingt.
 */
export function retryDelayAfter(failStreak: number): number | null {
  if (!Number.isInteger(failStreak) || failStreak < 1) return null;
  return retryDelays()[failStreak - 1] ?? null;
}

/** Netzfehler, bei denen die Anfrage die DoorBird sicher nicht erreicht hat. */
export const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * Darf ein gescheiterter Impuls schnell (3, 8, 20 s) wiederholt werden?
 * Nur, wenn sicher ist, dass das Relais nicht geschaltet hat: Die DoorBird
 * hat mit einem Fehler geantwortet, oder die Verbindung kam gar nicht zustande.
 * Nach einem Zeitlimit oder einem Abbruch mitten in der Anfrage ist offen, ob
 * sie schon gepulst hat; ein zweiter Impuls Sekunden später könnte ein Tor
 * treffen, das noch fährt. Dann geht es im normalen Takt weiter.
 */
export function fastRetrySafe(f: { httpStatus?: number | null; errorName?: string | null; causeCode?: string | null }): boolean {
  if (typeof f.httpStatus === "number") return f.httpStatus < 200 || f.httpStatus >= 300;
  if (f.errorName === "TimeoutError" || f.errorName === "AbortError") return false;
  return !!f.causeCode && NOT_SENT_CODES.has(f.causeCode);
}

/**
 * Eine geplante Wiederholung findet nur statt, solange dasselbe Offenhalten
 * noch laeuft und sein Ende nicht erreicht ist.
 */
export function retryStillDue(s: { sameHold: boolean; now: number; until: number }): boolean {
  return s.sameHold && s.now < s.until;
}

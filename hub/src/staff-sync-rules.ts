/**
 * Takt des Personal-Abgleichs mit der Cloud (emp-control), als reine Regel
 * (ohne I/O, testbar): `staffSyncDelayMs`.
 *
 * Tagsueber und solange jemand eingestempelt ist, jede Minute. Nachts
 * (23–6 Uhr Ortszeit) nur alle 4 Minuten, und das nur, wenn laut letztem
 * Stand niemand eingestempelt ist und der letzte Abruf geklappt hat. Ein
 * veralteter Stand „niemand eingestempelt“ kann im Waechter hoechstens einen
 * zusaetzlichen Alarm ausloesen, nie einen unterdruecken; wer nachts
 * eingestempelt ist, wird weiter jede Minute abgeglichen, damit ein
 * Ausstempeln nach spaetestens einer Minute zaehlt. Scheitert nachts ein
 * Abruf, kommt der naechste Versuch nach STAFF_SYNC_RETRY_MS, solange der
 * Stand noch frisch ist (`staffStaleAfterMs`).
 */
import { berlinHour } from "./agent/quiet.js";

/** Abstand zwischen zwei Abrufen tagsueber (wie bisher). */
export const STAFF_SYNC_INTERVAL_MS = 60_000;
/** Abstand nachts, wenn niemand eingestempelt ist. */
export const STAFF_SYNC_NIGHT_MS = 4 * 60_000;
/**
 * Nachts nach einem gescheiterten Abruf: naechster Versuch so lange nach
 * dessen Start, solange der letzte gute Abruf juenger als STAFF_STALE_MS
 * ist. Zwischen dem naechtlichen Abruf (240 s nach dem letzten guten) und
 * der Grenze von 300 s haben so noch zwei weitere Versuche Platz, auch wenn
 * jeder bis ins Zeitlimit laeuft. Danach wieder jede Minute.
 */
export const STAFF_SYNC_RETRY_MS = 15_000;
/** Zeitlimit eines Abrufs (staff.ts). */
export const STAFF_FETCH_TIMEOUT_MS = 20_000;
/**
 * Ab diesem Alter gilt die Personal-Uebersicht als veraltet
 * (`staffSummary().stale`). Der Takt bleibt mit Zeitlimit darunter: Der
 * naechste Abruf startet hoechstens STAFF_SYNC_NIGHT_MS nach dem Start des
 * letzten und endet spaetestens STAFF_FETCH_TIMEOUT_MS danach.
 */
export const STAFF_STALE_MS = 5 * 60_000;

/**
 * Ab welchem Alter der Stand als veraltet gilt, je nach Abstand, der nach
 * dem letzten guten Abruf geplant wurde (`okDelayMs`). Im Takt von einer
 * Minute STAFF_STALE_MS. Im langsamen Nacht-Takt ist ein Stand bis
 * STAFF_SYNC_NIGHT_MS alt der Normalfall; die Grenze waechst darum um den
 * laengeren Abstand. So gilt die Uebersicht bei einem Ausfall nie frueher
 * als veraltet als im Minuten-Takt: Erst ein Ausfall von mehr als
 * STAFF_STALE_MS minus einem Abstand macht sie veraltet, wie bisher.
 * Unbekannter Abstand (null, nach einem Neustart): STAFF_STALE_MS.
 */
export function staffStaleAfterMs(okDelayMs: number | null | undefined): number {
  if (typeof okDelayMs !== "number" || !Number.isFinite(okDelayMs)) return STAFF_STALE_MS;
  const extra = Math.min(okDelayMs, STAFF_SYNC_NIGHT_MS) - STAFF_SYNC_INTERVAL_MS;
  return STAFF_STALE_MS + Math.max(0, extra);
}

/**
 * Wartezeit bis zum naechsten Abruf: `delayMs` ab dem Start des letzten
 * (`lastStartAt`), beides auf einer Uhr, die niemand stellt
 * (performance.now() in staff.ts, wie die Timer selbst). Nie negativ und nie
 * laenger als `delayMs`: Auch wenn eine Uhr zurueckspringt, kommt der naechste
 * Abruf spaetestens einen Abstand nach dem Ende des letzten.
 */
export function staffSyncWaitMs(lastStartAt: number, now: number, delayMs: number): number {
  const wait = lastStartAt + delayMs - now;
  if (!Number.isFinite(wait)) return delayMs;
  return Math.min(delayMs, Math.max(0, wait));
}

/** Nachtfenster des Abgleichs: 23:00–05:59 Ortszeit. */
export function staffSyncNight(hour: number): boolean {
  return Number.isInteger(hour) && (hour >= 23 || hour < 6);
}

/**
 * Wartezeit bis zum naechsten Abruf, gezaehlt ab dem Start des letzten.
 * `clockedIn`: Eingestempelte laut letztem Stand. `failed`: Der letzte
 * Abruf ist gescheitert (Netz, HTTP, Antwort) – dann tagsueber und bei
 * Eingestempelten wieder nach einer Minute, nachts nach STAFF_SYNC_RETRY_MS,
 * solange `sinceOkMs` (Zeit seit dem Start des letzten guten Abrufs, null =
 * keiner seit dem Start des Hubs) unter `staleAfterMs` liegt (Standard
 * STAFF_STALE_MS; staff.ts gibt `staffStaleAfterMs` mit), sonst nach einer
 * Minute. Ist die Ortszeit nicht lesbar, gilt der Takt des Tages.
 */
export function staffSyncDelayMs(
  now: Date,
  opts: { clockedIn: number; failed: boolean; sinceOkMs?: number | null; staleAfterMs?: number }
): number {
  let hour: number;
  try {
    hour = berlinHour(now);
  } catch {
    return STAFF_SYNC_INTERVAL_MS;
  }
  if (!staffSyncNight(hour) || !(opts.clockedIn === 0)) return STAFF_SYNC_INTERVAL_MS;
  if (!opts.failed) return STAFF_SYNC_NIGHT_MS;
  const since = opts.sinceOkMs;
  const limit =
    typeof opts.staleAfterMs === "number" && Number.isFinite(opts.staleAfterMs) && opts.staleAfterMs > 0
      ? opts.staleAfterMs
      : STAFF_STALE_MS;
  const fresh = typeof since === "number" && Number.isFinite(since) && since >= 0 && since < limit;
  return fresh ? STAFF_SYNC_RETRY_MS : STAFF_SYNC_INTERVAL_MS;
}

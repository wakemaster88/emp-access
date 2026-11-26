/**
 * Regeln der Soundweb-Verbindungen (soundweb.ts), ohne Netz und ohne
 * Hub-Einstellungen testbar (soundweb-rules.test.ts):
 *
 *   - reconnectDelay: Wartezeit bis zum naechsten Anwaehlen eines nicht
 *     erreichbaren Prozessors. Die ersten 10 Versuche verdoppeln von 3 auf
 *     60 s, danach alle 5 Minuten und nach rund einer Stunde Wartezeit alle
 *     15 Minuten. Ein Geraet ohne einen einzigen Regler kann nichts
 *     abonnieren und nichts stellen: dort von Anfang an 15 Minuten.
 *   - shouldReport: Welche Geraete die Meldung im Minutentakt enthaelt.
 *     Verbundene immer (ihr Lebenszeichen), getrennte nur bei einem Wechsel
 *     und sonst alle 10 Minuten.
 *
 * Ein Auftrag (SOUNDWEB_SYNC, SOUNDWEB_SET) und jede geaenderte
 * Konfiguration verbinden sofort, unabhaengig von dieser Wartezeit.
 */

export const RECONNECT_MIN_MS = 3_000;
export const RECONNECT_MAX_MS = 60_000;
/** Versuche mit der kurzen, verdoppelnden Wartezeit. */
export const RECONNECT_FAST_TRIES = 10;
export const RECONNECT_SLOW_MS = 5 * 60_000;
export const RECONNECT_IDLE_MS = 15 * 60_000;
/** Ab so viel Wartezeit insgesamt gilt RECONNECT_IDLE_MS. */
export const RECONNECT_IDLE_AFTER_MS = 3_600_000;

function fastDelay(failures: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, failures - 1));
}

/**
 * Wartezeit nach dem `failures`-ten gescheiterten Versuch in Folge (ab 1).
 * Versuch 1 bis 10: 3, 6, 12, 24, 48 s, dann 60 s; danach 5 min, bis die
 * Wartezeiten zusammen eine Stunde erreichen, dann 15 min. Ohne Regler
 * (`hasControls` false) immer 15 min.
 */
export function reconnectDelay(failures: number, hasControls: boolean): number {
  if (!hasControls) return RECONNECT_IDLE_MS;
  const n = Math.max(1, Math.floor(failures));
  if (n <= RECONNECT_FAST_TRIES) return fastDelay(n);
  let waited = 0;
  for (let k = 1; k <= RECONNECT_FAST_TRIES; k++) waited += fastDelay(k);
  // Versuche nach den schnellen: 5 min, bis eine Stunde gewartet ist.
  const slowTries = Math.ceil((RECONNECT_IDLE_AFTER_MS - waited) / RECONNECT_SLOW_MS);
  return n <= RECONNECT_FAST_TRIES + slowTries ? RECONNECT_SLOW_MS : RECONNECT_IDLE_MS;
}

/** Lebenszeichen eines getrennten Geraets in der Minutenmeldung. */
export const DISCONNECTED_REPORT_MS = 10 * 60_000;

export interface ReportedState {
  connected: boolean;
  error: string | null;
  at: number;
}

/**
 * Gehoert das Geraet in die Meldung im Minutentakt? Verbunden: ja. Getrennt:
 * nur, wenn es noch nie gemeldet wurde, als verbunden gemeldet war, der
 * Fehlertext sich geaendert hat oder die letzte Meldung 10 Minuten alt ist.
 */
export function shouldReport(
  device: { connected: boolean; error: string | null; reported: ReportedState | null },
  now: number
): boolean {
  if (device.connected) return true;
  const r = device.reported;
  if (!r) return true;
  if (r.connected || r.error !== device.error) return true;
  return now - r.at >= DISCONNECTED_REPORT_MS;
}

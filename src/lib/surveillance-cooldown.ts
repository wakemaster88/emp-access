/**
 * Sperrzeit der Überwachungs-Meldungen je Kamera und Art: Web-Push unter
 * `10:PERSON`, Telegram unter `tg:10:PERSON` in SurveillanceConfig.lastPushByKey.
 * Reine Logik und ein schmaler Speicher-Zugang, damit sich das Setzen ohne
 * Datenbank testen lässt.
 *
 * Die Sperrzeit wird vor dem Senden gesetzt, und zwar atomar: eine einzelne
 * Anweisung schreibt genau den eigenen Schlüssel, und nur, wenn er fehlt oder
 * älter als die Sperrzeit ist (claimCooldown). Gesendet wird nur, wenn dabei
 * eine Zeile geändert wurde. Push und Telegram einer Sichtung laufen
 * nebeneinander; jeder schreibt nur seinen Schlüssel, der des anderen bleibt
 * stehen. Wie bisher verbraucht auch eine gescheiterte Sendung die Sperrzeit.
 */

/**
 * Zeitpunkte im Format von Date.toISOString(). Nur so geschriebene Werte
 * zählen als Sperrzeit; in diesem Format ist der Textvergleich (Sortierung
 * "C") zugleich der zeitliche, das nutzt die Anweisung in der Datenbank.
 */
export const COOLDOWN_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Dasselbe Muster für Postgres (`~`). */
export const COOLDOWN_ISO_SQL = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$";

/** Sperrzeit in Millisekunden; mindestens eine Minute, wie in der Einstellung. */
export function cooldownMs(minutes: number): number {
  return Math.max(1, Number.isFinite(minutes) ? minutes : 1) * 60_000;
}

/**
 * Darf zum Zeitpunkt `at` unter `key` gesendet werden? Ja, wenn der Schlüssel
 * fehlt, kein Zeitpunkt im Format COOLDOWN_ISO_RE ist oder mindestens
 * `minutes` zurückliegt. Ein Zeitpunkt nach `at` sperrt ebenfalls.
 */
export function cooldownOpen(
  map: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
  at: Date,
  minutes: number,
): boolean {
  const last = map?.[key];
  if (typeof last !== "string" || !COOLDOWN_ISO_RE.test(last)) return true;
  const lastMs = Date.parse(last);
  if (!Number.isFinite(lastMs)) return true;
  return at.getTime() - lastMs >= cooldownMs(minutes);
}

/** Speicher der Sperrzeiten (Datenbank, in Tests nachgebaut). */
export interface CooldownStore {
  /**
   * Schreibt `iso` unter `key` der Zeile `configId`, wenn der Schlüssel fehlt,
   * kein Zeitpunkt im Format COOLDOWN_ISO_RE ist oder höchstens `notAfterIso`
   * ist; alle anderen Schlüssel bleiben, wie sie sind. Eine einzelne,
   * atomare Anweisung. Liefert die Zahl der geänderten Zeilen (0 oder 1).
   */
  claim(configId: number, key: string, iso: string, notAfterIso: string): Promise<number>;
}

/**
 * Sperrzeit für `key` setzen, wenn sie offen ist (dieselbe Bedingung wie
 * cooldownOpen, aber in einer Anweisung geprüft und geschrieben). true = die
 * Zeile wurde geändert, die Meldung darf hinaus; false = ein anderer Aufruf
 * war schneller oder die Sperrzeit läuft noch.
 */
export async function claimCooldown(
  store: CooldownStore,
  opts: { configId: number; key: string; at: Date; minutes: number },
): Promise<boolean> {
  const notAfter = new Date(opts.at.getTime() - cooldownMs(opts.minutes)).toISOString();
  return (await store.claim(opts.configId, opts.key, opts.at.toISOString(), notAfter)) > 0;
}

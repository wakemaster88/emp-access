/**
 * Regeln zum Lebenszeichen des Hub-Prozesses (ohne I/O, testbar). Schreiben
 * und Lesen der Datei: alive-mark.ts.
 */
import { ChangeLog } from "./change-log.js";

export const ALIVE_INTERVAL_MS = 30_000;

/**
 * Gespeichertes Lebenszeichen lesen (ohne I/O, testbar): ISO-Zeit im Feld
 * `at`, nicht in der Zukunft (eine Minute Uhrenabweichung erlaubt). Alles
 * andere gilt als „unbekannt“.
 */
export function parseAliveMark(raw: string, now: number): string | null {
  try {
    const at = (JSON.parse(raw) as { at?: unknown } | null)?.at;
    if (typeof at !== "string") return null;
    const t = Date.parse(at);
    if (Number.isNaN(t) || t > now + 60_000) return null;
    return new Date(t).toISOString();
  } catch {
    return null;
  }
}

/**
 * Was nach einem Schreibversuch zu tun ist (ohne I/O, testbar). Nach einem
 * Fehler darf der alte Stand nicht auf der Platte bleiben: Er wuerde mit
 * jedem Takt aelter, und der naechste Start hielte ihn fuer das Ende seines
 * Vorgaengers. Ins Log kommt ein Fehler einmal je Grund und die Erholung
 * einmal, nicht alle 30 s dieselbe Zeile.
 */
export class AliveWriteState {
  private failLog = new ChangeLog();
  private failing = false;

  /**
   * `error` = Grund des gescheiterten Schreibens, null = geschrieben. Liefert,
   * ob der alte Stand zu entfernen ist, und die Zeile fuers Log (null = keine).
   */
  after(error: string | null, now: number): { removeOld: boolean; log: string | null } {
    if (error == null) {
      const recovered = this.failing;
      this.failing = false;
      // Derselbe Grund soll nach einer Erholung wieder im Log stehen.
      if (recovered) this.failLog = new ChangeLog();
      return { removeOld: false, log: recovered ? "Lebenszeichen: Schreiben klappt wieder" : null };
    }
    this.failing = true;
    return {
      removeOld: true,
      log: this.failLog.shouldLog("write", error, now) ? `Lebenszeichen: Schreiben fehlgeschlagen (${error})` : null,
    };
  }
}

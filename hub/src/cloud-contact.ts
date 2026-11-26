/**
 * Letzter gelungener Aufruf an die Cloud (config.ts, `api`): Jede Antwort mit
 * Status 2xx zaehlt, nicht nur das Lebenszeichen. Die Regeln (rules.ts)
 * entscheiden danach, ob der Hub im Notbetrieb ist. Ohne Abhaengigkeiten,
 * damit config.ts es einbinden kann.
 *
 * Kommt der Kontakt nach einer Pause zurueck (oder zum ersten Mal seit dem
 * Start), ruft `noteCloudContact` die angemeldeten Beobachter
 * (`onContactResumed`): Die Regeln melden dann sofort ihre Laeufe aus dem
 * Notbetrieb und sichern den Kontakt, statt auf ihren naechsten Takt zu warten.
 */

let lastContactAt: number | null = null;
const resumed: Array<{ gapMs: number; fn: () => void }> = [];

/**
 * Ist der Kontakt nach einer Pause zurueck? `prev`: letzter Kontakt davor,
 * null = seit dem Start keiner.
 */
export function contactResumed(prev: number | null, at: number, gapMs: number): boolean {
  return prev === null || at - prev > gapMs;
}

/** Gelungener Aufruf an die Cloud. */
export function noteCloudContact(at = Date.now()): void {
  const prev = lastContactAt;
  if (lastContactAt === null || at > lastContactAt) lastContactAt = at;
  for (const r of resumed) {
    if (!contactResumed(prev, at, r.gapMs)) continue;
    // Nach dem laufenden Aufruf, damit dessen Antwort zuerst verarbeitet wird;
    // ein Fehler des Beobachters erreicht den Aufrufer nicht.
    setImmediate(() => {
      try {
        r.fn();
      } catch {
        /* Beobachter fangen ihre Fehler selbst; hier nur zur Sicherheit */
      }
    });
  }
}

/** Zeit des letzten gelungenen Aufrufs (ms) seit dem Start; null = noch keiner. */
export function lastCloudContactAt(): number | null {
  return lastContactAt;
}

/** Beobachter fuer „Kontakt nach mehr als `gapMs` ohne Aufruf zurueck“. Muss seine Fehler selbst fangen. */
export function onContactResumed(gapMs: number, fn: () => void): void {
  resumed.push({ gapMs, fn });
}

/**
 * Auftraege aus der Cloud ausfuehren, ohne dass ein Fehler im Handler den Hub
 * beendet (ohne I/O, testbar). Der Hub beendet sich bewusst bei jeder
 * unbehandelten Promise-Ablehnung; ein Handler, der wirft statt ein Ergebnis
 * zu liefern (z. B. Tor oeffnen, waehrend die Kamera-Liste nicht abrufbar
 * ist), nahm deshalb den ganzen Hub mit.
 */

export interface GuardedResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Kurzer Fehlertext, auch wenn etwas anderes als ein Error geworfen wurde. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string" && e) return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/** Fuehrt `run` aus; ein geworfener Fehler wird zum Ergebnis „fehlgeschlagen“. */
export async function runGuarded(run: () => Promise<GuardedResult> | GuardedResult): Promise<GuardedResult> {
  try {
    return await run();
  } catch (e) {
    return { success: false, error: `Unerwarteter Fehler: ${errorText(e)}` };
  }
}

/**
 * Ergebnis als JSON fuer die Meldung an die Cloud. Laesst sich das Ergebnis
 * nicht serialisieren (Zyklus, BigInt), geht die Meldung ohne die Nutzdaten
 * hinaus statt gar nicht: Sonst bliebe der Auftrag in der Cloud haengen.
 */
export function resultBody(r: GuardedResult): string {
  try {
    return JSON.stringify(r);
  } catch (e) {
    return JSON.stringify({
      success: r.success,
      error: r.error ?? (r.success ? undefined : "Unbekannter Fehler"),
      result: { dropped: `Ergebnis nicht übertragbar: ${errorText(e)}` },
    });
  }
}

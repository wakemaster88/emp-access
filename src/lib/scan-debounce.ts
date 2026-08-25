import { scanLockMessage } from "./scan-lock";

/**
 * Debounce-Fenster fuer doppelte Scans am selben Geraet mit demselben Code.
 * Drehkreuz-Scanner senden den gleichen QR-/RFID-Code haeufig mehrfach binnen
 * Sekundenbruchteilen (Hardware-Bouncing oder Mehrfachlesungen). Liegt der
 * vorige Scan innerhalb des Fensters, schreiben wir KEINEN neuen Scan-
 * Datensatz.
 */
export const DEBOUNCE_WINDOW_MS = 5_000;

export type DebounceDecision = {
  granted: boolean;
  message: string;
  locked: boolean;
};

/**
 * Entscheidet, wie auf einen Scan im Debounce-Fenster geantwortet wird.
 *
 * Wichtig: der Pi schaltet das Relais bei JEDEM `granted: true`. Eine
 * Debounce-Antwort ist also kein reines Audit-Detail, sondern oeffnet das
 * Drehkreuz erneut - und zwar ohne Scan in der Historie. Deshalb darf ein
 * Eintritt im Debounce-Fenster niemals erneut freigeben: sonst kommt eine
 * weitergegebene Karte zweimal durch, waehrend der Monitor nur einen Eintritt
 * und danach die Abweisung zeigt.
 *
 * Ausgaenge geben das vorige Ergebnis weiter. Dort ist ein zweites Oeffnen
 * harmlos, und niemand soll im Gelaende eingesperrt werden.
 */
export function resolveDebounce(opts: {
  previousResult: string;
  previousScanTime: Date;
  isExitScan: boolean;
  deviceLockSeconds: number | null | undefined;
  now: Date;
}): DebounceDecision {
  const granted = opts.previousResult === "GRANTED";

  if (!granted || opts.isExitScan) {
    return {
      granted,
      message: granted ? "Zutritt gewährt" : "Bereits gerade abgewiesen",
      locked: false,
    };
  }

  const lockSeconds = opts.deviceLockSeconds ?? 0;
  const remainingMs = lockSeconds > 0
    ? opts.previousScanTime.getTime() + lockSeconds * 1000 - opts.now.getTime()
    : 0;

  if (remainingMs > 0) {
    return { granted: false, message: scanLockMessage(remainingMs), locked: true };
  }

  return {
    granted: false,
    message: "Bereits freigegeben – bitte durchgehen",
    locked: false,
  };
}

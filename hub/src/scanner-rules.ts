/**
 * Regeln des Netzwerk-Scans (scanner.ts), ohne Netz testbar
 * (scanner-rules.test.ts).
 *
 * Teilscan: Die MAC-Adressen kommen aus der ARP-Tabelle des Macs und des
 * Routers. Faellt eine der beiden Quellen in einem Lauf aus, fehlen auf
 * einen Schlag viele Geraete, obwohl sie im Netz sind. Liefert ein Scan
 * weniger als die Haelfte der MACs des letzten guten Laufs, meldet der Hub
 * ihn der Cloud als `partial`: Sie schreibt alles Gesehene, zaehlt und
 * loescht aber keine fehlenden Geraete. Ein solcher Lauf ist kein guter
 * Lauf und aendert den Vergleichswert nicht.
 */

/** Weniger als die Haelfte der MACs des letzten guten Laufs (ohne Vergleich: nie). */
export function scanLooksPartial(beforeWithMac: number, nowWithMac: number): boolean {
  if (!(beforeWithMac > 0)) return false;
  return nowWithMac * 2 < beforeWithMac;
}

/**
 * So lange gilt ein guter Lauf als Vergleich. Danach zaehlt der naechste
 * Lauf wieder als gut: Ist das Netz wirklich kleiner geworden (ein VLAN
 * abgeschaltet), raeumt die Cloud die fehlenden Geraete nach einem Tag wie
 * sonst auf.
 */
export const SCAN_BASELINE_MAX_AGE_MS = 24 * 3_600_000;

export interface ScanBaseline {
  withMac: number;
  at: number;
}

/**
 * Ein Lauf mit `withMac` MACs: Teilscan ja/nein und der Vergleichswert fuer
 * den naechsten Lauf (ein guter Lauf ersetzt ihn, ein Teilscan nicht).
 */
export function scanStep(
  baseline: ScanBaseline | null,
  withMac: number,
  now: number
): { partial: boolean; baseline: ScanBaseline } {
  const usable = baseline && now - baseline.at < SCAN_BASELINE_MAX_AGE_MS ? baseline : null;
  const partial = scanLooksPartial(usable?.withMac ?? 0, withMac);
  return { partial, baseline: partial && usable ? usable : { withMac, at: now } };
}

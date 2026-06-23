/**
 * Auswahl des "richtigen" Tickets, wenn ein gescannter Code (RFID/QR/Barcode/
 * UUID) auf MEHRERE Tickets passt.
 *
 * Hintergrund: `rfidCode` und `qrCode` sind im Schema NICHT eindeutig (nur
 * `barcode` und `uuid` sind `@unique`). Eine Karte/ein Code kann deshalb an
 * mehreren Tickets haengen – typischerweise ein dauerhaftes Abo/eine Vereins-
 * Mitgliedschaft UND ein altes Einzel-Zeitticket (DURATION). Die fruehere
 * Auswahl-Heuristik kannte den DURATION-Ablauf nicht und konnte ein laengst
 * abgelaufenes Zeitticket dem gueltigen Abo vorziehen ("Zeitticket abgelaufen"
 * trotz gueltigem Abo).
 *
 * Diese Auswahl bewertet Kandidaten nach (in dieser Prioritaet):
 *   1. Aktuell nutzbar (Status + Zeitraum + DURATION nicht abgelaufen)
 *   2. Zeitraum offen
 *   3. DURATION nicht abgelaufen
 *   4. Dauerhafte Berechtigung (Abo/Verein) vor Einzel-Ticket
 *   5. Status-Rang (VALID > REDEEMED > PAUSED > CANCELED)
 *
 * INVALID/PROTECTED werden grundsaetzlich am niedrigsten gewertet.
 */
export interface ScanCandidate {
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  validityType: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: Date | null;
  subscriptionId?: number | null;
  vereinId?: number | null;
}

/** Liegt `now` im (tagesgenauen) Gueltigkeitszeitraum des Tickets? */
function isDateWindowOpen(t: ScanCandidate, now: Date): boolean {
  const endOk =
    !t.endDate || new Date(new Date(t.endDate).setUTCHours(23, 59, 59, 999)) >= now;
  const startOk = !t.startDate || new Date(t.startDate) <= now;
  return endOk && startOk;
}

/**
 * Ist ein DURATION-Zeitticket bereits abgelaufen? Nur relevant, wenn der Timer
 * ueberhaupt gestartet wurde (`firstScanAt` gesetzt). Ein noch nicht gescanntes
 * DURATION-Ticket gilt NICHT als abgelaufen.
 */
export function isDurationExpired(t: ScanCandidate, now: Date): boolean {
  if ((t.validityType ?? "DATE_RANGE") !== "DURATION") return false;
  if (!t.validityDurationMinutes || !t.firstScanAt) return false;
  const expiresAt =
    new Date(t.firstScanAt).getTime() + t.validityDurationMinutes * 60_000;
  return now.getTime() > expiresAt;
}

/**
 * Bewertet ein Ticket als Scan-Kandidat. Hoeher = besser geeignet. Die
 * Gewichte sind so gestaffelt, dass jede Prioritaetsstufe die darunter
 * liegenden dominiert (strikte Rangfolge statt Summen-Vermischung).
 */
export function scanCandidateScore(t: ScanCandidate, now: Date): number {
  // Hart gesperrte/ungueltige Tickets nie vor einem nutzbaren Ticket waehlen.
  if (t.status === "INVALID" || t.status === "PROTECTED") return 0;

  const dateOk = isDateWindowOpen(t, now);
  const durationExpired = isDurationExpired(t, now);
  const usableNow =
    dateOk &&
    !durationExpired &&
    (t.status === "VALID" || t.status === "REDEEMED");
  const isMembership = t.subscriptionId != null || t.vereinId != null;

  const statusRank =
    t.status === "VALID" ? 400
    : t.status === "REDEEMED" ? 300
    : t.status === "PAUSED" ? 200
    : t.status === "CANCELED" ? 100
    : 0;

  return (
    (usableNow ? 1_000_000 : 0) +
    (dateOk ? 100_000 : 0) +
    (durationExpired ? 0 : 10_000) +
    (isMembership ? 1_000 : 0) +
    statusRank
  );
}

/**
 * Waehlt aus mehreren Kandidaten (gleicher Code) das am besten geeignete
 * Ticket. Bei Gleichstand bleibt die Eingabereihenfolge erhalten (es wird nur
 * bei STRIKT hoeherem Score gewechselt) – stabil und vorhersehbar.
 */
export function pickBestScanCandidate<T extends ScanCandidate>(
  candidates: T[],
  now: Date = new Date(),
): T | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestScore = scanCandidateScore(best, now);
  for (let i = 1; i < candidates.length; i++) {
    const score = scanCandidateScore(candidates[i], now);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }
  return best;
}

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
 *
 * Mit `deviceAreaIds` (Bereiche des Geraets) zaehlt davor noch: nutzbar UND
 * fuer diesen Bereich gueltig. Ein Baendchen traegt so Abo und Stundenkarte,
 * und jedes Geraet nimmt das passende Ticket.
 */
import { isDurationPastBerlinDay } from "./duration-ticket";

export interface ScanCandidate {
  id?: number;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  validityType: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: Date | null;
  slotStart?: string | null;
  slotEnd?: string | null;
  subscriptionId?: number | null;
  vereinId?: number | null;
  accessAreaId?: number | null;
  ticketAreas?: Array<{ accessAreaId: number }> | null;
  // Index-Signatur: Aufrufer laden unterschiedliche Felder an Abo und Service.
  subscription?: { areas?: Array<{ id: number }> | null; [key: string]: unknown } | null;
  service?: { serviceAreas?: Array<{ accessAreaId: number }> | null; [key: string]: unknown } | null;
}

/**
 * Bereiche, für die ein Ticket gilt (ohne Verein). Leer = keine Angabe, das
 * Ticket gilt dann überall (wie im Scan-Endpunkt).
 */
export function candidateAreaIds(t: ScanCandidate): number[] {
  return [
    ...(t.accessAreaId != null ? [t.accessAreaId] : []),
    ...(t.ticketAreas ?? []).map((a) => a.accessAreaId),
    ...(t.subscription?.areas ?? []).map((a) => a.id),
    ...(t.service?.serviceAreas ?? []).map((a) => a.accessAreaId),
  ];
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
export function scanCandidateScore(t: ScanCandidate, now: Date, deviceAreaIds: number[] = []): number {
  // Hart gesperrte/ungueltige Tickets nie vor einem nutzbaren Ticket waehlen.
  if (t.status === "INVALID" || t.status === "PROTECTED") return 0;

  const dateOk = isDateWindowOpen(t, now);
  // Stundenkarte von einem frueheren Tag (nie gescannt) gilt nicht mehr:
  // sonst gewinnt sie gegen das neue Ticket auf demselben Baendchen.
  const durationExpired = isDurationExpired(t, now) || isDurationPastBerlinDay(t, now);
  const usableNow =
    dateOk &&
    !durationExpired &&
    (t.status === "VALID" || t.status === "REDEEMED");
  const isMembership = t.subscriptionId != null || t.vereinId != null;
  // Baendchen am Kunden: Abo und Stundenkarte koennen denselben Code tragen.
  // Am Geraet gewinnt das nutzbare Ticket, das fuer diesen Bereich gilt.
  let coversDevice = false;
  if (usableNow && deviceAreaIds.length > 0 && t.vereinId == null) {
    const areas = candidateAreaIds(t);
    coversDevice = areas.length > 0 && areas.some((a) => deviceAreaIds.includes(a));
  }

  const statusRank =
    t.status === "VALID" ? 400
    : t.status === "REDEEMED" ? 300
    : t.status === "PAUSED" ? 200
    : t.status === "CANCELED" ? 100
    : 0;

  return (
    (coversDevice ? 10_000_000 : 0) +
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
  deviceAreaIds: number[] = [],
): T | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestScore = scanCandidateScore(best, now, deviceAreaIds);
  for (let i = 1; i < candidates.length; i++) {
    const score = scanCandidateScore(candidates[i], now, deviceAreaIds);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }
  return best;
}

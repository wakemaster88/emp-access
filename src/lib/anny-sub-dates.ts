/**
 * Laufzeit von anny-Abos.
 *
 * anny liefert in `starts_at` einer plan-subscription den Beginn des laufenden
 * Abrechnungszeitraums (monatlich), nicht den Vertragsbeginn. Wer daraus Beginn
 * und Ende ableitet, schiebt beides jeden Monat einen Monat weiter: ein im Mai
 * gekauftes 24-Monats-Abo stand im November auf "gültig bis November +2 Jahre"
 * und wäre nie abgelaufen (Befund 20.11.2026).
 *
 * Deshalb gilt: Der Vertragsbeginn ist der früheste je gesehene Beginn.
 */

/**
 * Frühestes von gemeldetem Zeitraum-Beginn, bekanntem Beginn (Ticket) und
 * Anlage bei anny (`created_at`, praktisch der Kauf).
 */
export function annyContractStart(
  periodStart: Date | null,
  knownStart: Date | null,
  createdAt: Date | null = null,
): Date | null {
  let best: Date | null = null;
  for (const d of [periodStart, knownStart, createdAt]) {
    if (!d || Number.isNaN(d.getTime())) continue;
    if (!best || d.getTime() < best.getTime()) best = d;
  }
  return best;
}

/** anny `minimum_term` (in Intervallen des Plans) in Monaten; null, wenn unbekannt. */
export function minimumTermMonths(term: number | null | undefined, interval: string | null | undefined): number | null {
  if (!term || term <= 0 || !Number.isFinite(term)) return null;
  const i = (interval ?? "month").toLowerCase();
  if (i.startsWith("year") || i === "yearly" || i === "annual") return term * 12;
  if (i.startsWith("month")) return term;
  return null;
}

/** Monate addieren, am Monatsende auf den letzten Tag begrenzt (31.01. + 1 = 28./29.02.). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * Nach der Mindestlaufzeit läuft ein aktives anny-Abo monatlich weiter. Dann
 * gilt es bis zum Ende des laufenden Abrechnungsmonats, sonst bis Vertragsende.
 */
export function annyRunningEnd(contractEnd: Date | null, periodStart: Date | null, active: boolean): Date | null {
  if (!contractEnd || !periodStart || !active) return contractEnd;
  const periodEnd = addMonths(periodStart, 1);
  return periodEnd.getTime() > contractEnd.getTime() ? periodEnd : contractEnd;
}

/**
 * Vertragsbeginn aus einem verschobenen Beginn zurückrechnen: so viele ganze
 * Monate zurück, bis er nicht mehr nach dem ersten Abgleich (`firstSeen`) liegt.
 * Toleranz 1 Tag, weil der Abgleich den Kauf erst etwas später sieht.
 */
export function reconstructAnnyStart(shiftedStart: Date, firstSeen: Date, toleranceMs = 24 * 60 * 60 * 1000): Date {
  let months = 0;
  let candidate = shiftedStart;
  while (candidate.getTime() > firstSeen.getTime() + toleranceMs && months < 120) {
    months++;
    candidate = addMonths(shiftedStart, -months);
  }
  return candidate;
}

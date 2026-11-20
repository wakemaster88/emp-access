/**
 * Gehören zwei Abo-Tickets derselben Person?
 *
 * anny führt ein Konto je E-Mail. Kauft ein Elternteil ein Kids-Abo über sein
 * Konto, tragen beide Abos dieselbe Adresse, denselben Namen und dasselbe
 * Geburtsdatum (das des Kontoinhabers). Name und Geburtsdatum allein trennen
 * Eltern und Kind also nicht.
 *
 * Was sie trennt: Eine Person fährt nicht mit zwei Abos zugleich. Zwei Abos,
 * deren Laufzeiten sich deutlich überschneiden, sind zwei Personen. Folgen sie
 * aufeinander (Verlängerung, Wechsel von Kids auf Ride), ist es dieselbe.
 */

/** Überschneidung, die noch als Verlängerung gilt (früh gekauftes Folge-Abo). */
export const SUCCESSION_OVERLAP_DAYS = 31;

const DAY_MS = 86_400_000;

export interface AboPeriod {
  startDate: Date | null;
  endDate: Date | null;
}

/** Tage, in denen beide Abos gleichzeitig laufen. Ohne Datum zählt die Laufzeit als offen. */
export function overlapDays(a: AboPeriod, b: AboPeriod): number {
  const start = Math.max(a.startDate?.getTime() ?? -Infinity, b.startDate?.getTime() ?? -Infinity);
  const end = Math.min(a.endDate?.getTime() ?? Infinity, b.endDate?.getTime() ?? Infinity);
  if (!(end > start)) return 0;
  return (end - start) / DAY_MS;
}

/**
 * Können zwei Abos mit gleichem Namen und Geburtsdatum dieselbe Person sein?
 * Nur wenn sie nacheinander laufen. Fehlt ein Datum, ist die Laufzeit offen
 * und überschneidet sich: dann lieber nicht zusammenführen.
 */
export function canBeSamePerson(a: AboPeriod, b: AboPeriod): boolean {
  return overlapDays(a, b) <= SUCCESSION_OVERLAP_DAYS;
}

/** Laufen unter diesen Abos zwei gleichzeitig? Dann gehören sie mehreren Personen. */
export function hasConcurrent(periods: AboPeriod[]): boolean {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      if (!canBeSamePerson(periods[i], periods[j])) return true;
    }
  }
  return false;
}

/**
 * Welche weiteren Abos mit gleichem Namen und Geburtsdatum gehören zur Person
 * der `anchors`? Laufen alle nacheinander, alle (Verlängerung, Wechsel von
 * Kids auf Ride). Läuft auch nur ein Paar gleichzeitig, ist es ein
 * Familienkonto mit mehreren Personen und unklar, welches ältere Abo wem
 * gehört: dann keins. Der Kunde wählt seine Abos dann selbst.
 */
export function samePersonAbos<T extends AboPeriod>(anchors: AboPeriod[], others: T[]): T[] {
  return hasConcurrent([...anchors, ...others]) ? [] : others;
}

/**
 * Fehlen für das kommende Jahr noch Ausnahmetage?
 *
 * Saisons gelten jedes Jahr wieder (Tag und Monat), Ausnahmetage nur an ihrem
 * Datum. Feiertage wie Ostermontag oder Pfingstmontag wandern aber jedes Jahr,
 * und Saisongrenzen hängen oft an den Ferien. Ohne neue Einträge gilt im
 * nächsten Jahr an einem Feiertag einfach der normale Wochentag – montags also
 * meist geschlossen. Das fällt sonst erst auf, wenn Website, Kunden-App und
 * Schichtplanung schon falsche Zeiten zeigen.
 *
 * Reine Funktion ohne Datenbank, damit Seite und Tests sie teilen.
 */

export interface NextYearProfile {
  name: string;
  parentId: number | null;
  exceptions: { date: string }[];
}

export interface NextYearGap {
  /** Das Jahr, für das Einträge fehlen. */
  year: number;
  /** Bereiche (ohne Unterprofile), denen Einträge fehlen. */
  areas: string[];
  /** Anzahl Unterprofile, denen Einträge fehlen. */
  subCount: number;
}

/** Ab diesem Monat (1–12) des laufenden Jahres meldet die Seite die Lücke. */
export const NEXT_YEAR_HINT_FROM_MONTH = 9;

/**
 * Profile, die im laufenden Jahr Ausnahmetage haben, im nächsten aber keine.
 * Vor September (`fromMonth`) null: so früh plant niemand das Folgejahr.
 * Ein Profil ganz ohne Ausnahmetage im laufenden Jahr zählt nicht – dort gibt
 * es offenbar nichts, das jährlich nachzutragen wäre.
 */
export function nextYearExceptionGap(
  profiles: NextYearProfile[],
  todayYmd: string,
  fromMonth: number = NEXT_YEAR_HINT_FROM_MONTH,
): NextYearGap | null {
  const year = Number(todayYmd.slice(0, 4));
  const month = Number(todayYmd.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < fromMonth) return null;

  const thisYear = `${year}-`;
  const nextYear = `${year + 1}-`;
  const missing = profiles.filter(
    (p) =>
      p.exceptions.some((e) => e.date.startsWith(thisYear)) &&
      !p.exceptions.some((e) => e.date.startsWith(nextYear)),
  );
  if (missing.length === 0) return null;
  return {
    year: year + 1,
    areas: missing.filter((p) => p.parentId == null).map((p) => p.name),
    subCount: missing.filter((p) => p.parentId != null).length,
  };
}

/** „Wasserski, Shop und 2 Unterprofile“ */
export function describeNextYearGap(gap: NextYearGap): string {
  const parts = [...gap.areas];
  if (gap.subCount > 0) parts.push(gap.subCount === 1 ? "1 Unterprofil" : `${gap.subCount} Unterprofile`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

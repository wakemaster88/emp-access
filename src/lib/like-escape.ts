/**
 * Genaue Vergleiche ohne Rücksicht auf Groß- und Kleinschreibung.
 *
 * Prisma übersetzt `{ equals: wert, mode: "insensitive" }` in `spalte ILIKE $n`
 * und reicht den Wert unverändert durch. In ILIKE stehen `_` und `%` aber für
 * beliebige Zeichen: „anna_schmidt@…“ fände so auch „anna.schmidt@…“. Für
 * E-Mail-Adressen, Namen und Artikelbezeichnungen ist das nie gewollt, deshalb
 * werden die Sonderzeichen hier maskiert. Postgres nimmt bei ILIKE ohne
 * ESCAPE-Angabe den Backslash als Maskierzeichen.
 */

/** Maskiert `\`, `%` und `_`, damit ILIKE den Wert wörtlich vergleicht. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Prisma-Filter: gleich, Groß- und Kleinschreibung egal, Sonderzeichen wörtlich. */
export function equalsInsensitive(value: string): { equals: string; mode: "insensitive" } {
  return { equals: escapeLike(value), mode: "insensitive" };
}

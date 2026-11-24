/**
 * Bausteine fuer CSV-Exporte (Semikolon, fuer Excel und andere
 * Tabellenprogramme). Rein und ohne Abhaengigkeiten, damit Server und Tests
 * sie gleich nutzen.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Textzelle: Beginnt der Text mit =, +, -, @, Tab oder Wagenruecklauf, kommt
 * ein Hochkomma davor. Tabellenprogramme lesen die Zelle dann als Text und
 * nicht als Formel. Nur fuer Texte gedacht; Zahlen und Betraege bleiben
 * unveraendert.
 */
export function csvText(s: string): string {
  return FORMULA_START.test(s) ? `'${s}` : s;
}

/** Setzt die Zelle in Anfuehrungszeichen, wenn sie ; " oder einen Zeilenumbruch enthaelt. */
export function csvQuote(s: string): string {
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Textzelle fertig fuer die CSV-Zeile: erst als Text sichern, dann bei Bedarf quoten. */
export function csvTextCell(s: string): string {
  return csvQuote(csvText(s));
}

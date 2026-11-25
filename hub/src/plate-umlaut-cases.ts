/**
 * Testfälle zum Abgleich mit der Fahrzeugliste bei Kreisen mit Umlaut.
 * Dieselben Fälle prüfen den Hub (plate-match.test.ts, whitelistLookup) und
 * die Cloud (src/lib/plate-match.test.ts, matchAllowedPlate), damit beide
 * gleich entscheiden. Nur Testdaten, erfundene Kennzeichen.
 */
export interface UmlautMatchCase {
  name: string;
  /** Kennzeichen der Listen-Einträge, wie in der Fahrzeugverwaltung eingetragen. */
  list: string[];
  /** Lesung (OCR liefert nur A–Z). */
  reading: string;
  /** Kennzeichen des getroffenen Eintrags, null = kein Treffer. */
  hit: string | null;
}

export const UMLAUT_MATCH_CASES: readonly UmlautMatchCase[] = [
  { name: "Lesung LUD trifft den Eintrag LÜD", list: ["LÜD-AB 123"], reading: "LUD-AB 123", hit: "LÜD-AB 123" },
  { name: "kompakte Lesung trifft ebenso", list: ["LÜD-AB 123"], reading: "LUDAB123", hit: "LÜD-AB 123" },
  { name: "Eintrag ohne Trennzeichen", list: ["LÜDAB123"], reading: "LUD-AB 123", hit: "LÜDAB123" },
  {
    name: "LÜN, BÜR und TÜ: jeder trifft nur sich selbst",
    list: ["LÜN-CD 45", "BÜR-EF 678E", "TÜ-GH 9012"],
    reading: "BUR-EF 678E",
    hit: "BÜR-EF 678E",
  },
  { name: "Lesung in der Form mit Umlaut trifft wie bisher", list: ["LÜD-AB 123"], reading: "LÜD-AB 123", hit: "LÜD-AB 123" },
  { name: "Lesung BO trifft nie einen Eintrag mit BÖ", list: ["BÖ-AB 123"], reading: "BO-AB 123", hit: null },
  { name: "eine Ziffer Unterschied", list: ["LÜD-AB 123"], reading: "LUD-AB 124", hit: null },
  { name: "ein Buchstabe Unterschied", list: ["LÜD-AB 123"], reading: "LUD-AC 123", hit: null },
  { name: "ein Zeichen im Kreis Unterschied", list: ["LÜD-AB 123"], reading: "LUN-AB 123", hit: null },
  { name: "ein Zeichen zu viel", list: ["LÜD-AB 123"], reading: "LUD-AB 123E", hit: null },
  { name: "ein Zeichen zu wenig", list: ["LÜD-AB 123"], reading: "LUD-AB 12", hit: null },
  {
    name: "zwei Einträge nur im Umlaut verschieden: die gleich geschriebene Lesung trifft ihren",
    list: ["LÜD-AB 123", "LUD-AB 123"],
    reading: "LUD-AB 123",
    hit: "LUD-AB 123",
  },
  {
    name: "zwei Einträge nur im Umlaut verschieden: die Form mit Umlaut trifft ihren",
    list: ["LÜD-AB 123", "LUD-AB 123"],
    reading: "LÜD-AB 123",
    hit: "LÜD-AB 123",
  },
  {
    name: "zwei Einträge mit derselben Schreibweise ohne Umlaut: kein Treffer",
    list: ["TÜ-AB 123", "TÜÄ-B 123"],
    reading: "TU-AB 123",
    hit: null,
  },
  { name: "Eintrag mit UE statt Ü trifft die Lesung ohne Umlaut nicht", list: ["LUED-AB 123"], reading: "LUD-AB 123", hit: null },
  { name: "Eintrag mit UE statt Ü trifft weiter die Lesung mit UE", list: ["LUED-AB 123"], reading: "LUEDAB123", hit: "LUED-AB 123" },
  { name: "Eintrag mit OE statt Ö trifft die Lesung ohne Umlaut nicht", list: ["GOE-XY 123"], reading: "GO-XY 123", hit: null },
  { name: "GÖ-AB kann GOA-B sein (St. Goar): kein Vergleich ohne Umlaut", list: ["GÖ-AB 123"], reading: "GOA-B 123", hit: null },
  { name: "LÜN-A kann LU-NA sein (Ludwigshafen): kein Vergleich ohne Umlaut", list: ["LÜN-A 123"], reading: "LU-NA 123", hit: null },
  { name: "Umlaut in den Erkennungsbuchstaben zählt nicht", list: ["XY-ÄB 123"], reading: "XY-AB 123", hit: null },
  { name: "Kennzeichen ohne Umlaut unverändert", list: ["GT-AB 4321", "LÜD-AB 123"], reading: "GT-AB 4321", hit: "GT-AB 4321" },
];

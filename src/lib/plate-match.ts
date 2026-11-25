import { GERMAN_CITY_CODES } from "@/lib/plate-cities";

/**
 * Kennzeichen-Abgleich mit der Fahrzeugliste (reine Logik). Dieselbe Regel
 * wie am Hub (hub/src/plate-match.ts: whitelistLookup, plainUmlautForm),
 * damit der Cloud-Rückfall gleich entscheidet wie der Hub; beide prüfen
 * dieselben Testfälle (hub/src/plate-umlaut-cases.ts).
 *
 * Verglichen wird Zeichen für Zeichen nach normalizePlate. Kreise mit Umlaut
 * liest die Kamera ohne Umlaut (LÜD als LUD): Darum vergleicht der Abgleich
 * zusätzlich die Schreibweise ohne Umlaut eines Listen-Eintrags, wenn es
 * keine Verwechslung mit einem anderen Kreis geben kann (Entscheidung vom
 * 25.11.2026).
 */

/** Kennzeichen normalisieren: Grossbuchstaben, ohne Leerzeichen/Bindestriche/Punkte. */
export function normalizePlate(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .replace(/[Ä]/g, "AE")
    .replace(/[Ö]/g, "OE")
    .replace(/[Ü]/g, "UE")
    .replace(/ß/g, "SS")
    .replace(/[^A-Z0-9]/g, "");
}

/** Anzeigeform: Grossbuchstaben, Leerraum zu einem Leerzeichen. */
export function formatPlateDisplay(plate: string): string {
  return plate.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Ä, Ö, Ü wie die Texterkennung: A, O, U. */
export function withoutUmlaut(s: string): string {
  return s.replace(/Ä/g, "A").replace(/Ö/g, "O").replace(/Ü/g, "U");
}

/** Alle Aufteilungen eines Buchstabenblocks in Kreis (1–3) und Erkennungsbuchstaben (1–2). */
function letterSplits(letters: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let cityLen = 1; cityLen <= 3; cityLen++) {
    const midLen = letters.length - cityLen;
    if (midLen >= 1 && midLen <= 2) out.push([letters.slice(0, cityLen), letters.slice(cityLen)]);
  }
  return out;
}

/** Lässt sich der Buchstabenblock als Kennzeichen eines Kreises der Liste lesen? */
function readsAsKnownCity(letters: string, known: ReadonlySet<string>): boolean {
  return letterSplits(letters).some(([city]) => known.has(city));
}

/**
 * Schreibweise ohne Umlaut eines Listen-Eintrags, normalisiert („LÜD-AB 123“
 * → „LUDAB123“). null, wenn der Kreis keinen Umlaut hat oder es eine
 * Verwechslung mit einem anderen Kreis geben kann: wenn die Schreibweise ohne
 * Umlaut selbst ein Kreis der Liste ist (BÖ und BO) oder sich ihre Buchstaben
 * anders aufgeteilt als Kennzeichen eines Kreises der Liste lesen lassen
 * (GÖ-AB 123 und GOA-B 123, LÜN-A 123 und LU-NA 123).
 */
export function plainUmlautForm(plate: string, known: ReadonlySet<string> = GERMAN_CITY_CODES): string | null {
  const up = plate.trim().toUpperCase();
  const m = up.match(/^([A-ZÄÖÜ]+)(?:[\s-]+([A-ZÄÖÜ]+))?[\s-]*(\d{1,4}[EH]?)$/);
  if (!m) return null;
  const [, first, second, digits] = m;
  // Mit Trennzeichen steht der Kreis fest, ohne gilt jede Aufteilung.
  const splits: Array<[string, string]> = second !== undefined ? [[first, second]] : letterSplits(first);
  // Umlaute gibt es nur im Kreis, nie in den Erkennungsbuchstaben.
  const umlautCity = splits.some(
    ([city, mid]) =>
      city.length <= 3 && mid.length >= 1 && mid.length <= 2 && /[ÄÖÜ]/.test(city) && !/[ÄÖÜ]/.test(mid)
  );
  if (!umlautCity) return null;
  const letters = withoutUmlaut(first + (second ?? ""));
  if (readsAsKnownCity(letters, known)) return null;
  return letters + digits;
}

/**
 * Listen-Eintrag zu einer normalisierten Lesung: zuerst exakt, sonst über die
 * Schreibweise ohne Umlaut – dann nur, wenn genau ein Eintrag passt.
 */
export function matchAllowedPlate<T extends { plate: string; plateNormalized: string }>(
  normalized: string,
  list: readonly T[],
  known: ReadonlySet<string> = GERMAN_CITY_CODES
): T | null {
  const exact = list.find((v) => v.plateNormalized === normalized);
  if (exact) return exact;
  const plain = list.filter((v) => plainUmlautForm(v.plate, known) === normalized);
  return plain.length === 1 ? plain[0] : null;
}

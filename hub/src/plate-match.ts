/**
 * Kennzeichen-Abgleich gegen die Whitelist – reine Logik ohne Hub-Konfiguration
 * (testbar, plate-match.test.ts). OCR und Ablauf liegen in plate.ts.
 *
 * Sicherheitsregel: Tor/Shelly schaltet nur ein EXAKTER normalisierter
 * Whitelist-Treffer, und nur mit genug Confidence (plateMayActuate).
 * Ein unscharfer Treffer (gleicher Ziffernblock, ein bis zwei Zeichen daneben)
 * ist nur ein Hinweis fuer Log und Anzeige (`probable`). Er wird bewusst NICHT
 * mehr zum Whitelist-Kennzeichen umgeschrieben: Sonst wuerde jeder Abnehmer
 * des Ergebnisses (lokale Aktoren, Cloud-Fallback, Waechter) ein fremdes
 * Fahrzeug fuer ein freigegebenes halten.
 */

import { GERMAN_CITY_CODES, UMLAUT_CITY_BY_PLAIN } from "./plate-cities.js";

export interface OcrCandidate {
  plate: string;
  confidence: number;
  source: string;
}

export interface OcrResult {
  plate: string | null;
  confidence: number;
  candidates: OcrCandidate[];
  raw: string[];
}

/** Was der Abgleich von einem Whitelist-Eintrag braucht. */
export interface WhitelistPlate {
  plate: string;
  plateNormalized: string;
}

/**
 * exact = normalisiert identisch mit einem Whitelist-Eintrag;
 * auto  = plausibel und sicher gelesen, steht aber nicht auf der Liste.
 */
export type PlateMatchKind = "exact" | "auto";

export interface PlatePick {
  plate: string | null;
  matchKind: PlateMatchKind | null;
  /**
   * Confidence genau der Lesung, die zu `plate` fuehrte. null = unbekannt
   * (Treffer nur im Roh-Text, der keinen eigenen Wert hat) – schaltet nie.
   */
  confidence: number | null;
  /**
   * Unscharfer Whitelist-Treffer: „vermutlich dieses Kennzeichen“.
   * Nur Hinweis – schaltet nie und landet nie in `plate`.
   */
  probable: string | null;
}

/**
 * Bekannte Kreise: alle deutschen Unterscheidungszeichen (plate-cities.ts).
 * Früher nur ~35 Ruhrgebiets-Kreise – Kennzeichen aus der Region wurden
 * trotz sicherer Lesung verworfen (Befund 20.11.2026).
 */
export const KNOWN_CITY: ReadonlySet<string> = GERMAN_CITY_CODES;

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

/** Ä, Ö, Ü wie die OCR: A, O, U. */
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

/**
 * Lässt sich der Buchstabenblock (ohne Umlaut, vor den Ziffern) als
 * Kennzeichen eines Kreises der Liste lesen? GOAB als GOA-B, LUNA als LU-NA.
 */
function readsAsKnownCity(letters: string, known: ReadonlySet<string>): boolean {
  return letterSplits(letters).some(([city]) => known.has(city));
}

/**
 * Lesung mit einem Kreis in der Schreibweise ohne Umlaut („LUD-AB 123“): die
 * Form mit Umlaut („LÜD-AB 123“), sonst null. Nur für Kreise aus
 * UMLAUT_CITY_BY_PLAIN und nur, wenn sich die Zeichen nicht auch als
 * Kennzeichen eines anderen Kreises lesen lassen: „GO-AB 123“ kann ebenso
 * GOA-B 123 sein und bleibt, wie gelesen.
 */
export function umlautReading(
  plate: string,
  known: ReadonlySet<string> = KNOWN_CITY,
  byPlain: ReadonlyMap<string, string> = UMLAUT_CITY_BY_PLAIN
): string | null {
  const m = plate.trim().toUpperCase().match(/^([A-Z]{1,3})-([A-Z]{1,2}) (\d{1,4}[EH]?)$/);
  if (!m) return null;
  const [, city, mid, digits] = m;
  if (known.has(city)) return null;
  const withUmlaut = byPlain.get(city);
  if (!withUmlaut || readsAsKnownCity(city + mid, known)) return null;
  return `${withUmlaut}-${mid} ${digits}`;
}

/**
 * Schreibweise ohne Umlaut eines Listen-Eintrags, normalisiert („LÜD-AB 123“
 * → „LUDAB123“), mit der der Abgleich zusätzlich vergleicht (Entscheidung vom
 * 25.11.2026). null, wenn der Kreis keinen Umlaut hat oder es eine
 * Verwechslung mit einem anderen Kreis geben kann: wenn die Schreibweise ohne
 * Umlaut selbst ein Kreis der Liste ist (BÖ und BO) oder sich ihre Buchstaben
 * anders aufgeteilt als Kennzeichen eines Kreises der Liste lesen lassen
 * (GÖ-AB 123 und GOA-B 123, LÜN-A 123 und LU-NA 123). Verglichen werden auch
 * so alle Zeichen; nur die Umlaut-Punkte im Kreis zählen nicht.
 */
export function plainUmlautForm(plate: string, known: ReadonlySet<string> = KNOWN_CITY): string | null {
  const up = plate.trim().toUpperCase();
  const m = up.match(/^([A-ZÄÖÜ]+)(?:[\s-]+([A-ZÄÖÜ]+))?[\s-]*(\d{1,4}[EH]?)$/);
  if (!m) return null;
  const [, first, second, digits] = m;
  // Mit Trennzeichen steht der Kreis fest, ohne gilt jede Aufteilung.
  const splits: Array<[string, string]> =
    second !== undefined ? [[first, second]] : letterSplits(first);
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
 * Kern des Abgleichs mit der Fahrzeugliste: Eintrag zu einer normalisierten
 * Lesung, Zeichen für Zeichen. Zuerst exakt (normalizePlate), sonst über die
 * Schreibweise ohne Umlaut (plainUmlautForm) – dann nur, wenn genau ein
 * Eintrag passt. Ein Eintrag mit OE statt Ö trifft weiter nur die Lesung
 * mit OE.
 */
export function whitelistLookup<T extends WhitelistPlate>(
  wl: readonly T[],
  known: ReadonlySet<string> = KNOWN_CITY
): (normalized: string) => T | null {
  const byNorm = new Map<string, T>();
  for (const v of wl) if (!byNorm.has(v.plateNormalized)) byNorm.set(v.plateNormalized, v);
  const byPlain = new Map<string, T[]>();
  for (const v of wl) {
    const plain = plainUmlautForm(v.plate, known);
    if (plain) byPlain.set(plain, [...(byPlain.get(plain) ?? []), v]);
  }
  return (n) => {
    const exact = byNorm.get(n);
    if (exact) return exact;
    const plain = byPlain.get(n);
    return plain?.length === 1 ? plain[0] : null;
  };
}

/**
 * Ist `reading` (eine OCR-Lesung) dasselbe Kennzeichen wie `plate`? Gleich
 * normalisiert oder in der Schreibweise ohne Umlaut (plainUmlautForm). Für
 * die Anzeige: Sicherheit der Lesung hinter einem Kennzeichen mit Umlaut.
 */
export function readsAs(reading: string, plate: string, known: ReadonlySet<string> = KNOWN_CITY): boolean {
  const n = normalizePlate(reading);
  return n === normalizePlate(plate) || n === plainUmlautForm(plate, known);
}

function digitSuffix(normalized: string): string {
  const m = normalized.match(/(\d{3,4}[EH]?)$/);
  return m?.[1] ?? "";
}

/** DE-Kennzeichen grob plausibel: 1–3 + 1–2 Buchstaben, ≥3 Ziffern. */
export function isPlausiblePlate(plate: string): boolean {
  return /^[A-ZÄÖÜ]{1,3}-[A-ZÄÖÜ]{1,2} \d{3,4}[EH]?$/.test(plate.trim().toUpperCase());
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * Waehlt aus einem OCR-Ergebnis das Kennzeichen.
 * `autoMinConf`: Mindest-Confidence fuer die Auto-Wahl ohne Whitelist-Treffer.
 */
export function pickPlate(
  result: OcrResult,
  wl: WhitelistPlate[],
  autoMinConf: number
): PlatePick {
  const lookup = whitelistLookup(wl);
  const candNorms = result.candidates.map((c) => ({
    plate: c.plate,
    n: normalizePlate(c.plate),
    conf: c.confidence,
  }));
  const rawNorms = result.raw.map((r) => normalizePlate(r)).filter((n) => n.length >= 5);

  // 1) Exakter Whitelist-Treffer (Zeichen für Zeichen, Kreis mit Umlaut auch
  //    in der Schreibweise ohne Umlaut, whitelistLookup).
  for (const { n } of candNorms) {
    const hit = lookup(n);
    if (hit) {
      // Dieselbe Lesung kann mehrfach vorkommen (ganzes Bild + Kachel): beste zaehlt.
      let conf = 0;
      for (const c of candNorms) if (c.n === n && c.conf > conf) conf = c.conf;
      return { plate: hit.plate, matchKind: "exact", confidence: conf, probable: null };
    }
  }
  for (const n of rawNorms) {
    const hit = lookup(n);
    if (hit) return { plate: hit.plate, matchKind: "exact", confidence: null, probable: null };
  }

  // 2) Unscharf: gleiche Länge ±1 und ≤2 Zeichenunterschied, gleiche Ziffern-Endung.
  //    Nur als Hinweis – das Ergebnis bleibt, was wirklich gelesen wurde (Schritt 3).
  let probable: string | null = null;
  fuzzy: for (const v of wl) {
    const want = v.plateNormalized;
    const wantDigits = digitSuffix(want);
    if (wantDigits.length < 3) continue;
    for (const { n, conf } of candNorms) {
      if (conf < 0.25) continue;
      if (digitSuffix(n) !== wantDigits) continue;
      if (Math.abs(n.length - want.length) > 1) continue;
      if (n.length === want.length && hamming(n, want) <= 2) {
        probable = v.plate;
        break fuzzy;
      }
      // Gleicher Ziffernblock, Buchstaben leicht daneben (X-L 474E vs BOXY474E)
      if (n.endsWith(wantDigits) && want.endsWith(wantDigits)) {
        const nLetters = n.slice(0, -wantDigits.length);
        const wLetters = want.slice(0, -wantDigits.length);
        if (nLetters.length >= 2 && wLetters.includes(nLetters)) {
          probable = v.plate;
          break fuzzy;
        }
      }
    }
  }

  // 3) Auto-Wahl: plausibles DE-Kennzeichen + bekannter Kreis. Ein Kreis mit
  //    Umlaut in der Schreibweise ohne Umlaut zählt mit und erscheint mit
  //    Umlaut (umlautReading).
  const autoOk = (plate: string, conf: number) => {
    if (conf < autoMinConf || !isPlausiblePlate(plate)) return false;
    const city = plate.split("-")[0] ?? "";
    return city.length >= 2 && (KNOWN_CITY.has(city) || umlautReading(plate) !== null);
  };
  const shown = (plate: string) => umlautReading(plate) ?? plate;

  if (result.plate && autoOk(result.plate, result.confidence)) {
    return { plate: shown(result.plate), matchKind: "auto", confidence: result.confidence, probable };
  }
  const top = result.candidates.find((c) => autoOk(c.plate, c.confidence));
  if (top) return { plate: shown(top.plate), matchKind: "auto", confidence: top.confidence, probable };
  return { plate: null, matchKind: null, confidence: null, probable };
}

/**
 * Darf dieser Treffer Tor/Shelly schalten? Entscheidend ist der EXAKTE
 * Whitelist-Treffer - ein unscharfer schaltet nie.
 *
 * Die Confidence ist nur eine zweite, bewusst niedrige Huerde gegen
 * Zufallslesungen: dass die OCR ein fremdes Kennzeichen Zeichen fuer Zeichen
 * als freigegebenes liest, ist auch bei maessiger Confidence unwahrscheinlich,
 * waehrend eine hohe Schwelle bekannte Fahrzeuge bei Daemmerung aussperrt.
 * Ohne Messwert (`null`: Treffer im Roh-Text oder Kennzeichen von der
 * Kamera-eigenen Erkennung) zaehlt allein der exakte Treffer.
 * Ein ungueltiger Schwellwert oder Messwert (NaN) schaltet nie.
 */
export function plateMayActuate(
  match: { exact: boolean; confidence: number | null | undefined },
  minConf: number
): boolean {
  if (!match.exact) return false;
  if (!Number.isFinite(minConf)) return false;
  if (match.confidence == null) return true;
  if (!Number.isFinite(match.confidence)) return false;
  return match.confidence >= minConf;
}

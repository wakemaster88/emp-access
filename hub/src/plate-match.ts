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

/** Bekannte Kreise (NRW/Umgebung) – gleiche Basis wie PlateOCR.swift. */
export const KNOWN_CITY = new Set([
  "RE", "BOR", "UN", "GE", "EN", "DO", "BO", "E", "HA", "HER", "HAM", "BOT",
  "MG", "NE", "D", "K", "AC", "BN", "SU", "LEV", "GL", "ME", "RS", "W", "SG",
  "OB", "MH", "DU", "KR", "VIE", "WES", "KLE", "COE", "ST", "SO",
]);

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
  const byNorm = new Map(wl.map((v) => [v.plateNormalized, v.plate]));
  const candNorms = result.candidates.map((c) => ({
    plate: c.plate,
    n: normalizePlate(c.plate),
    conf: c.confidence,
  }));
  const rawNorms = result.raw.map((r) => normalizePlate(r)).filter((n) => n.length >= 5);

  // 1) Exakter Whitelist-Treffer.
  for (const { n } of candNorms) {
    const hit = byNorm.get(n);
    if (hit) {
      // Dieselbe Lesung kann mehrfach vorkommen (ganzes Bild + Kachel): beste zaehlt.
      let conf = 0;
      for (const c of candNorms) if (c.n === n && c.conf > conf) conf = c.conf;
      return { plate: hit, matchKind: "exact", confidence: conf, probable: null };
    }
  }
  for (const n of rawNorms) {
    const hit = byNorm.get(n);
    if (hit) return { plate: hit, matchKind: "exact", confidence: null, probable: null };
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
      // Gleicher Ziffernblock, Buchstaben leicht daneben (Q-L 626E vs BOQC626E)
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

  // 3) Auto-Wahl: plausibles DE-Kennzeichen + bekannter Kreis.
  const autoOk = (plate: string, conf: number) => {
    if (conf < autoMinConf || !isPlausiblePlate(plate)) return false;
    const city = plate.split("-")[0] ?? "";
    return city.length >= 2 && KNOWN_CITY.has(city);
  };

  if (result.plate && autoOk(result.plate, result.confidence)) {
    return { plate: result.plate, matchKind: "auto", confidence: result.confidence, probable };
  }
  const top = result.candidates.find((c) => autoOk(c.plate, c.confidence));
  if (top) return { plate: top.plate, matchKind: "auto", confidence: top.confidence, probable };
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

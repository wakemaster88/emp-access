import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePlate,
  pickPlate,
  plateMayActuate,
  type OcrResult,
  type PlatePick,
} from "./plate-match.js";

/** Wie in plate.ts: HUB_PLATE_MIN_CONF (Auto-Wahl) und HUB_ALPR_ACTUATE_MIN_CONF (Schalten). */
const AUTO_MIN = 0.8;
const ACT_MIN = 0.5;

const WL = [
  { plate: "BO-XY 474E", plateNormalized: "BOXY474E" },
  { plate: "DO-XZ 575", plateNormalized: "DOXZ575" },
];

function ocr(cands: Array<[string, number]>, raw: string[] = []): OcrResult {
  return {
    plate: null,
    confidence: 0,
    candidates: cands.map(([plate, confidence]) => ({ plate, confidence, source: "alpr" })),
    raw,
  };
}

/** So entscheiden cameras.ts/vehicle-actuate.ts, ob Tor/Shelly schalten. */
function actuates(pick: PlatePick): boolean {
  return plateMayActuate({ exact: pick.matchKind === "exact", confidence: pick.confidence }, ACT_MIN);
}

function isWhitelisted(plate: string | null): boolean {
  return !!plate && WL.some((v) => v.plateNormalized === normalizePlate(plate));
}

test("exakter Treffer mit hoher Confidence schaltet", () => {
  const pick = pickPlate(ocr([["BO-XY 474E", 0.96]]), WL, AUTO_MIN);
  assert.equal(pick.plate, "BO-XY 474E");
  assert.equal(pick.matchKind, "exact");
  assert.equal(pick.confidence, 0.96);
  assert.equal(pick.probable, null);
  assert.equal(actuates(pick), true);
});

test("exakter Treffer: Schreibweise egal, beste Lesung zaehlt", () => {
  const pick = pickPlate(ocr([["BOXY-474E", 0.5], ["BO-XY 474E", 0.93]]), WL, AUTO_MIN);
  assert.equal(pick.plate, "BO-XY 474E");
  assert.equal(pick.matchKind, "exact");
  assert.equal(pick.confidence, 0.93);
  assert.equal(actuates(pick), true);
});

test("ein Zeichen daneben schaltet nicht – auch bei hoher Confidence", () => {
  const pick = pickPlate(ocr([["BO-OY 474E", 0.99]]), WL, AUTO_MIN);
  // Gemeldet wird, was gelesen wurde – nie das Whitelist-Kennzeichen.
  assert.equal(pick.plate, "BO-OY 474E");
  assert.equal(pick.matchKind, "auto");
  assert.equal(isWhitelisted(pick.plate), false);
  assert.equal(pick.probable, "BO-XY 474E");
  assert.equal(actuates(pick), false);
});

test("zwei Zeichen daneben schalten nicht", () => {
  const pick = pickPlate(ocr([["BD-OY 474E", 0.99]]), WL, AUTO_MIN);
  // BD ist ein gültiges Zeichen: als fremdes Kennzeichen gelesen, nie als Whitelist.
  assert.equal(pick.plate, "BD-OY 474E");
  assert.equal(pick.matchKind, "auto");
  assert.equal(isWhitelisted(pick.plate), false);
  assert.equal(pick.probable, "BO-XY 474E");
  assert.equal(actuates(pick), false);
});

test("abweichende Ziffer schaltet nicht", () => {
  const pick = pickPlate(ocr([["BO-XY 479E", 0.99]]), WL, AUTO_MIN);
  assert.equal(pick.plate, "BO-XY 479E");
  assert.equal(pick.matchKind, "auto");
  assert.equal(isWhitelisted(pick.plate), false);
  assert.equal(actuates(pick), false);
});

test("Buchstaben-Teilstueck (OXY474E statt BOXY474E) schaltet nicht", () => {
  const pick = pickPlate(ocr([["O-XY 474E", 0.95]]), WL, AUTO_MIN);
  assert.equal(pick.plate, null);
  assert.equal(pick.matchKind, null);
  assert.equal(pick.probable, "BO-XY 474E");
  assert.equal(actuates(pick), false);
});

test("unscharfer Treffer mit niedriger Confidence: weder Kennzeichen noch Schaltung", () => {
  const pick = pickPlate(ocr([["BO-OY 474E", 0.3]]), WL, AUTO_MIN);
  assert.equal(pick.plate, null);
  assert.equal(pick.probable, "BO-XY 474E");
  assert.equal(actuates(pick), false);
});

test("exakter Treffer mit sehr niedriger Confidence schaltet nicht", () => {
  const pick = pickPlate(ocr([["BO-XY 474E", 0.3]]), WL, AUTO_MIN);
  assert.equal(pick.plate, "BO-XY 474E");
  assert.equal(pick.matchKind, "exact");
  assert.equal(actuates(pick), false);
  // Knapp unter der Schwelle bleibt zu, ab der Schwelle schaltet der exakte Treffer.
  assert.equal(actuates(pickPlate(ocr([["BO-XY 474E", 0.49]]), WL, AUTO_MIN)), false);
  assert.equal(actuates(pickPlate(ocr([["BO-XY 474E", 0.5]]), WL, AUTO_MIN)), true);
});

test("exakter Treffer nur im Roh-Text hat keine Confidence und schaltet trotzdem", () => {
  const pick = pickPlate(ocr([], ["bo xy 474e"]), WL, AUTO_MIN);
  assert.equal(pick.plate, "BO-XY 474E");
  assert.equal(pick.matchKind, "exact");
  assert.equal(pick.confidence, null);
  // Der exakte Treffer ist das Kriterium; ohne Messwert gibt es keine zweite Huerde.
  assert.equal(actuates(pick), true);
});

test("nicht gelistetes Kennzeichen schaltet nie", () => {
  const pick = pickPlate(ocr([["RE-AB 1234", 0.99]]), WL, AUTO_MIN);
  assert.equal(pick.plate, "RE-AB 1234");
  assert.equal(pick.matchKind, "auto");
  assert.equal(pick.probable, null);
  assert.equal(actuates(pick), false);
});

test("leere Whitelist: kein Treffer, kein Hinweis", () => {
  const pick = pickPlate(ocr([["BO-XY 474E", 0.99]]), [], AUTO_MIN);
  assert.equal(pick.matchKind, "auto");
  assert.equal(pick.probable, null);
  assert.equal(actuates(pick), false);
});

test("plateMayActuate: ungueltige Werte schalten nie", () => {
  assert.equal(plateMayActuate({ exact: true, confidence: 0.99 }, ACT_MIN), true);
  assert.equal(plateMayActuate({ exact: false, confidence: 1 }, ACT_MIN), false);
  // Ohne Messwert (Kamera-eigene Erkennung, Roh-Text) zaehlt der exakte Treffer.
  assert.equal(plateMayActuate({ exact: true, confidence: null }, ACT_MIN), true);
  assert.equal(plateMayActuate({ exact: true, confidence: undefined }, ACT_MIN), true);
  assert.equal(plateMayActuate({ exact: false, confidence: null }, ACT_MIN), false);
  assert.equal(plateMayActuate({ exact: true, confidence: 0.49 }, ACT_MIN), false);
  assert.equal(plateMayActuate({ exact: true, confidence: Number.NaN }, ACT_MIN), false);
  assert.equal(plateMayActuate({ exact: true, confidence: 1 }, Number.NaN), false);
});

test("Kennzeichen aus der Region gelten als bekannter Kreis (WAF, BE, GT, PB)", () => {
  for (const plate of ["WAF-AB 123", "BE-AB 340", "GT-AB 4321", "PB-AB 2345", "LIP-AB 345"]) {
    const pick = pickPlate(ocr([[plate, 0.95]]), WL, AUTO_MIN);
    assert.equal(pick.plate, plate);
    assert.equal(pick.matchKind, "auto");
    assert.equal(actuates(pick), false);
  }
});

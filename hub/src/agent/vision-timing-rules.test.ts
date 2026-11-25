import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectionCounters,
  readVisionTiming,
  secondsText,
  timingLine,
  timingText,
  type VisionCall,
  type VisionTiming,
} from "./vision-timing-rules.js";

const S = 1e9;
const NUM_CTX = 8192;

/** Antwort von Ollama wie in der Beschreibung der Messung: 18,4 s gesamt. */
const BODY = {
  message: { role: "assistant", content: "{}" },
  done: true,
  total_duration: 18_400_000_000,
  load_duration: 100_000_000,
  prompt_eval_count: 2310,
  prompt_eval_duration: 14_900_000_000,
  eval_count: 96,
  eval_duration: 3_200_000_000,
};

const timing = (o: Partial<VisionTiming> = {}): VisionTiming => ({ ...readVisionTiming(BODY, 18_450), ...o });

test("readVisionTiming: liest die sechs Zeitfelder und die Messung des Hubs", () => {
  assert.deepEqual(readVisionTiming(BODY, 18_450), {
    wallMs: 18_450,
    totalNs: 18_400_000_000,
    loadNs: 100_000_000,
    promptTokens: 2310,
    promptNs: 14_900_000_000,
    evalTokens: 96,
    evalNs: 3_200_000_000,
  });
});

test("readVisionTiming: fehlende oder unbrauchbare Felder werden null", () => {
  const empty = { wallMs: 5_000, totalNs: null, loadNs: null, promptTokens: null, promptNs: null, evalTokens: null, evalNs: null };
  assert.deepEqual(readVisionTiming({ message: { content: "{}" } }, 5_000), empty);
  assert.deepEqual(readVisionTiming(null, 5_000), empty);
  assert.deepEqual(readVisionTiming(undefined, 5_000), empty);
  assert.deepEqual(readVisionTiming("kein Objekt", 5_000), empty);
  assert.deepEqual(
    readVisionTiming({ total_duration: "18400000000", load_duration: -1, prompt_eval_count: NaN, prompt_eval_duration: Infinity, eval_count: null, eval_duration: {} }, 5_000),
    empty
  );
  // Einzelne Felder fehlen: Die uebrigen bleiben.
  assert.deepEqual(readVisionTiming({ total_duration: 2 * S, eval_count: 12.4 }, 2_100), { ...empty, wallMs: 2_100, totalNs: 2 * S, evalTokens: 12 });
  // Eine Dauer von 0 ist eine Angabe, kein fehlendes Feld.
  assert.equal(readVisionTiming({ load_duration: 0 }, 1).loadNs, 0);
  assert.equal(readVisionTiming(BODY, NaN).wallMs, 0);
  assert.equal(readVisionTiming(BODY, -5).wallMs, 0);
});

test("secondsText: Nanosekunden in Sekunden mit einer Nachkommastelle und Komma", () => {
  assert.equal(secondsText(18_400_000_000), "18,4 s");
  assert.equal(secondsText(14_949_999_999), "14,9 s");
  assert.equal(secondsText(100_000_000), "0,1 s");
  assert.equal(secondsText(0), "0,0 s");
  assert.equal(secondsText(120 * S), "120,0 s");
});

test("timingText: ganze Dauer, laden, Bild+Prompt und Antwort mit Token", () => {
  assert.equal(timingText(timing()), "18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token)");
});

test("timingText: Zeit, die kein Abschnitt erklärt, steht als Rest da", () => {
  // 30 s gesamt, die Abschnitte erklaeren 18,2 s: 11,8 s Rest (z. B. Warten auf einen laufenden Aufruf).
  assert.equal(
    timingText(timing({ wallMs: 30_050, totalNs: 30 * S })),
    "30,0 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token · Rest 11,8 s)"
  );
  // Unter einer halben Sekunde bleibt der Rest weg.
  assert.doesNotMatch(timingText(timing({ totalNs: 18_600_000_000 })), /Rest/);
});

test("timingText: misst der Hub deutlich länger als Ollama, stehen beide Zeiten da", () => {
  assert.equal(
    timingText(timing({ wallMs: 25_000 })),
    "18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token · im Hub 25,0 s)"
  );
  assert.doesNotMatch(timingText(timing({ wallMs: 19_300 })), /im Hub/);
});

test("timingText: fehlende Felder", () => {
  // Ohne total_duration steht vorn die Messung des Hubs (hier 18,62 s).
  assert.equal(timingText(timing({ totalNs: null, wallMs: 18_620 })), "18,6 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token)");
  // Nur Token oder nur Dauer.
  assert.equal(timingText(timing({ promptNs: null, evalTokens: null, loadNs: null, totalNs: null, wallMs: 18_620 })), "18,6 s (Bild+Prompt 2310 Token · Antwort 3,2 s)");
  // Ohne Dauer der Abschnitte gibt es keinen Rest.
  assert.equal(timingText(timing({ loadNs: null, promptNs: null, evalNs: null })), "18,4 s (Bild+Prompt 2310 Token · Antwort 96 Token)");
  // Gar keine Zeitangaben.
  assert.equal(timingText(readVisionTiming({}, 41_020)), "41,0 s (ohne Zeitangaben von Ollama)");
});

test("timingText: fast volles Kontextfenster steht bei Bild+Prompt", () => {
  assert.match(timingText(timing({ promptTokens: 7372 }), NUM_CTX), /Bild\+Prompt 14,9 s\/7372 Token/);
  assert.match(timingText(timing({ promptTokens: 7373 }), NUM_CTX), /Bild\+Prompt 14,9 s\/7373 von 8192 Token/);
  assert.match(timingText(timing({ promptTokens: 8192, promptNs: null }), NUM_CTX), /Bild\+Prompt 8192 von 8192 Token/);
  // Ohne Angabe des Fensters bleibt es bei der Zahl; die Antwort bekommt den Zusatz nie.
  assert.match(timingText(timing({ promptTokens: 8192, evalTokens: 8000 })), /Bild\+Prompt 14,9 s\/8192 Token · Antwort 3,2 s\/8000 Token/);
});

/* ------------------------------------------------------------ Zeile je Bewertung */

const T0 = 1_000_000;
const call = (label: string, endedSec: number, o: Partial<VisionCall> = {}): VisionCall => ({
  label,
  wallMs: 18_450,
  timing: timing(),
  endedAt: T0 + endedSec * 1000,
  ...o,
});

test("timingLine: ohne Aufruf keine Zeile, mit einem Aufruf Übersicht und Zeit bis zum Urteil", () => {
  assert.equal(timingLine("Eingang", [], T0), null);
  assert.equal(
    timingLine("Eingang", [call("Übersicht", 21.2)], T0),
    "Wächter: Eingang: Bildmodell Übersicht 18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token); Auslöser bis Urteil 21,2 s"
  );
});

test("timingLine: beide Aufrufe einer Personen-Bewertung in einer Zeile", () => {
  const close = call("Nahaufnahme", 67.8, {
    wallMs: 41_000,
    timing: timing({ wallMs: 41_000, totalNs: 41 * S, loadNs: 0, promptTokens: 7600, promptNs: 33 * S, evalTokens: 210, evalNs: 7.9 * S }),
  });
  assert.equal(
    timingLine("Eingang", [call("Übersicht", 21.2), close], T0, NUM_CTX),
    "Wächter: Eingang: Bildmodell Übersicht 18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token); " +
      "Nahaufnahme 41,0 s (laden 0,0 s · Bild+Prompt 33,0 s/7600 von 8192 Token · Antwort 7,9 s/210 Token); Auslöser bis Urteil 67,8 s"
  );
});

test("timingLine: ein gescheiterter Aufruf steht mit seiner Dauer da", () => {
  assert.equal(
    timingLine("Halle", [call("Übersicht", 123, { wallMs: 120_000, timing: null })], T0),
    "Wächter: Halle: Bildmodell Übersicht gescheitert nach 120,0 s; Auslöser bis Abbruch 123,0 s"
  );
  const line = timingLine("Halle", [call("Übersicht", 21.2), call("Nahaufnahme", 141.2, { wallMs: 120_000, timing: null })], T0);
  assert.match(line ?? "", /; Nahaufnahme gescheitert nach 120,0 s; Auslöser bis Abbruch 141,2 s$/);
  // Liegt das Ende vor dem Ausloeser (Uhr verstellt), entfaellt die Angabe.
  assert.equal(timingLine("Halle", [call("Übersicht", -5, { wallMs: 2_000, timing: null })], T0), "Wächter: Halle: Bildmodell Übersicht gescheitert nach 2,0 s");
});

test("inspectionCounters: je Aufruf und je Bewertung", () => {
  assert.deepEqual(inspectionCounters([], T0, NUM_CTX), []);
  assert.deepEqual(inspectionCounters([call("Übersicht", 21.2)], T0, NUM_CTX), ["sentinel_model_call", "sentinel_verdict"]);
  // Langsam (30 s oder laenger), Modell erst geladen, Kontextfenster fast voll, Urteil spaeter als 30 s.
  const slow = call("Nahaufnahme", 67.8, { wallMs: 30_000, timing: timing({ loadNs: 4 * S, promptTokens: 7373 }) });
  assert.deepEqual(inspectionCounters([call("Übersicht", 21.2), slow], T0, NUM_CTX), [
    "sentinel_model_call",
    "sentinel_model_call",
    "sentinel_model_slow",
    "sentinel_model_cold",
    "sentinel_model_ctx",
    "sentinel_verdict",
    "sentinel_verdict_late",
  ]);
  assert.deepEqual(inspectionCounters([call("Übersicht", 30)], T0, NUM_CTX), ["sentinel_model_call", "sentinel_verdict"]);
  assert.deepEqual(inspectionCounters([call("Übersicht", 30.1)], T0, NUM_CTX), ["sentinel_model_call", "sentinel_verdict", "sentinel_verdict_late"]);
  // Gescheitert: kein Urteil.
  assert.deepEqual(inspectionCounters([call("Übersicht", 123, { wallMs: 120_000, timing: null })], T0, NUM_CTX), ["sentinel_model_error"]);
  assert.deepEqual(inspectionCounters([call("Übersicht", 21.2), call("Nahaufnahme", 141, { timing: null })], T0, NUM_CTX), ["sentinel_model_call", "sentinel_model_error"]);
  // Ohne Angabe des Kontextfensters wird es nicht gezaehlt.
  assert.deepEqual(inspectionCounters([call("Übersicht", 5, { timing: timing({ promptTokens: 8192 }) })], T0, 0), ["sentinel_model_call", "sentinel_verdict"]);
});

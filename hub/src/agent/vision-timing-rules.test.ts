import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerCutOff,
  cutOffText,
  groupDigits,
  inspectionCounters,
  numPredictText,
  outputParts,
  readNumPredict,
  readVisionOutput,
  readVisionTiming,
  secondsText,
  timingLine,
  timingText,
  type VisionCall,
  type VisionOutput,
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

/* ------------------------------------------------------------ Inhalt der Antwort */

const NONE: VisionOutput = { contentChars: null, blankChars: 0, thinkingChars: 0, thinkingInline: false, doneReason: null };
const JSON_ANSWER = '{"auffaellig": true, "was": "Eine Person am Tor.", "dringlichkeit": "mittel"}';

test("readVisionOutput: Antworttext, Leerraum und done_reason", () => {
  assert.deepEqual(readVisionOutput({ ...BODY, message: { role: "assistant", content: JSON_ANSWER }, done_reason: "stop" }), {
    contentChars: JSON_ANSWER.length,
    blankChars: JSON_ANSWER.length - JSON_ANSWER.replace(/\s/g, "").length,
    thinkingChars: 0,
    thinkingInline: false,
    doneReason: "stop",
  });
  // Laenge wie geliefert, Leerraum am Ende zaehlt mit.
  const padded = readVisionOutput({ message: { content: `${JSON_ANSWER}\n\n${" ".repeat(400)}` } });
  assert.equal(padded.contentChars, JSON_ANSWER.length + 402);
  assert.equal(padded.blankChars, 8 + 402);
});

test("readVisionOutput: fehlende Felder", () => {
  assert.deepEqual(readVisionOutput(null), NONE);
  assert.deepEqual(readVisionOutput("kein Objekt"), NONE);
  assert.deepEqual(readVisionOutput({}), NONE);
  assert.deepEqual(readVisionOutput({ message: {} }), NONE);
  assert.deepEqual(readVisionOutput({ message: "Text" }), NONE);
  assert.deepEqual(readVisionOutput({ message: { content: 42, thinking: 7 }, done_reason: 3 }), NONE);
  // done_reason leer oder nur Leerraum: fehlt; ueberlang: gekuerzt.
  assert.equal(readVisionOutput({ done_reason: "  " }).doneReason, null);
  assert.equal(readVisionOutput({ done_reason: " length\n" }).doneReason, "length");
  assert.equal(readVisionOutput({ done_reason: "x".repeat(80) }).doneReason?.length, 40);
});

test("readVisionOutput: leere Antwort", () => {
  assert.deepEqual(readVisionOutput({ message: { content: "" }, done_reason: "stop" }), { ...NONE, contentChars: 0, doneReason: "stop" });
});

test("readVisionOutput: Denktext in message.thinking", () => {
  const o = readVisionOutput({ message: { content: JSON_ANSWER, thinking: "a".repeat(14_800) }, done_reason: "stop" });
  assert.equal(o.contentChars, JSON_ANSWER.length);
  assert.equal(o.thinkingChars, 14_800);
  assert.equal(o.thinkingInline, false);
  // Denktext ohne Antworttext.
  assert.deepEqual(readVisionOutput({ message: { content: "", thinking: "a".repeat(900) }, done_reason: "length" }), {
    contentChars: 0,
    blankChars: 0,
    thinkingChars: 900,
    thinkingInline: false,
    doneReason: "length",
  });
  // Ein leeres oder nur aus Leerraum bestehendes Feld ist kein Denktext.
  assert.equal(readVisionOutput({ message: { content: JSON_ANSWER, thinking: "" } }).thinkingChars, 0);
  assert.equal(readVisionOutput({ message: { content: JSON_ANSWER, thinking: " \n\n " } }).thinkingChars, 0);
});

test("readVisionOutput: Denkblock im Antworttext zählt als Denktext", () => {
  const think = "b".repeat(1_200);
  const o = readVisionOutput({ message: { content: `<think>${think}</think>\n\n${JSON_ANSWER}` } });
  assert.equal(o.thinkingChars, 1_200);
  assert.equal(o.thinkingInline, true);
  assert.equal(o.contentChars, JSON_ANSWER.length + 2);
  // Ohne oeffnendes Tag (die Vorlage oeffnet den Block selbst): alles bis „</think>“.
  const open = readVisionOutput({ message: { content: `${think}</think>${JSON_ANSWER}` } });
  assert.equal(open.thinkingChars, 1_200);
  assert.equal(open.contentChars, JSON_ANSWER.length);
  // Abgebrochen mitten im Denkblock: kein Antworttext.
  const cut = readVisionOutput({ message: { content: `\n<think>${think}` }, done_reason: "length" });
  assert.deepEqual(cut, { contentChars: 0, blankChars: 0, thinkingChars: 1_200, thinkingInline: true, doneReason: "length" });
  // Leerer Denkblock: kein Denktext, er zaehlt auch nicht zum Antworttext.
  const empty = readVisionOutput({ message: { content: `<think>\n\n</think>\n\n${JSON_ANSWER}` } });
  assert.deepEqual(empty, { ...NONE, contentChars: JSON_ANSWER.length + 2, blankChars: readVisionOutput({ message: { content: `\n\n${JSON_ANSWER}` } }).blankChars });
  // Feld und Denkblock zusammen.
  assert.equal(readVisionOutput({ message: { content: `<think>abc</think>{}`, thinking: "defg" } }).thinkingChars, 7);
});

test("groupDigits: ab fünf Stellen in Dreiergruppen", () => {
  assert.equal(groupDigits(0), "0");
  assert.equal(groupDigits(412), "412");
  assert.equal(groupDigits(4100), "4100");
  assert.equal(groupDigits(14_800), "14 800");
  assert.equal(groupDigits(1_234_567), "1 234 567");
  assert.equal(groupDigits(-14_800), "-14 800");
});

test("outputParts: Zeichen, Leerraum ab der Hälfte, Denktext, done_reason außer stop", () => {
  assert.deepEqual(outputParts(NONE), []);
  assert.deepEqual(outputParts({ ...NONE, contentChars: 412, blankChars: 60, doneReason: "stop" }), ["412 Zeichen"]);
  assert.deepEqual(outputParts({ ...NONE, contentChars: 0, doneReason: "length" }), ["0 Zeichen", "done_reason length"]);
  assert.deepEqual(outputParts({ ...NONE, contentChars: 4100, blankChars: 3700 }), ["4100 Zeichen, davon 3700 Leerraum"]);
  // Unter der Haelfte oder bei kurzem Text bleibt der Leerraum weg.
  assert.deepEqual(outputParts({ ...NONE, contentChars: 4100, blankChars: 2000 }), ["4100 Zeichen"]);
  assert.deepEqual(outputParts({ ...NONE, contentChars: 80, blankChars: 70 }), ["80 Zeichen"]);
  assert.deepEqual(outputParts({ ...NONE, contentChars: 412, thinkingChars: 14_800 }), ["412 Zeichen", "Denktext 14 800 Zeichen"]);
  assert.deepEqual(outputParts({ ...NONE, contentChars: 0, thinkingChars: 900, thinkingInline: true, doneReason: "length" }), [
    "0 Zeichen",
    "Denktext 900 Zeichen (im Antworttext)",
    "done_reason length",
  ]);
  // Ohne Antworttext-Feld steht nur, was da ist.
  assert.deepEqual(outputParts({ ...NONE, thinkingChars: 900, doneReason: "unload" }), ["Denktext 900 Zeichen", "done_reason unload"]);
});

test("timingText: mit Inhalt der Antwort", () => {
  const t = timing({ wallMs: 52_000, totalNs: 52 * S, loadNs: 0, promptTokens: 2900, promptNs: 5 * S, evalTokens: 3837, evalNs: 47 * S });
  const o: VisionOutput = { ...NONE, contentChars: 412, blankChars: 50, thinkingChars: 14_800, doneReason: "stop" };
  assert.equal(
    timingText(t, NUM_CTX, o),
    "52,0 s (laden 0,0 s · Bild+Prompt 5,0 s/2900 Token · Antwort 47,0 s/3837 Token, 412 Zeichen, Denktext 14 800 Zeichen)"
  );
  assert.match(timingText(t, NUM_CTX, { ...o, doneReason: "length" }), /Antwort 47,0 s\/3837 Token, 412 Zeichen, Denktext 14 800 Zeichen, done_reason length\)$/);
  // Ohne Angaben zum Inhalt wie bisher.
  assert.equal(timingText(timing(), 0, NONE), timingText(timing()));
  assert.equal(timingText(timing(), 0, null), "18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token)");
  // Ohne Zeitangaben zur Antwort steht der Inhalt allein.
  assert.equal(timingText(readVisionTiming({}, 41_020), 0, { ...NONE, contentChars: 0 }), "41,0 s (Antwort 0 Zeichen)");
});

/* ------------------------------------------------------------ Obergrenze der Antwort */

test("readNumPredict: nur eine ganze Zahl ab 1 ist eine Grenze, alles andere keine", () => {
  assert.equal(readNumPredict("400"), 400);
  assert.equal(readNumPredict(" 1024 \n"), 1024);
  assert.equal(readNumPredict("1"), 1);
  // Standard: nicht gesetzt oder leer.
  assert.equal(readNumPredict(undefined), null);
  assert.equal(readNumPredict(""), null);
  assert.equal(readNumPredict("   "), null);
  // Ungueltig: keine Grenze.
  for (const raw of ["0", "-1", "-400", "400.5", "4e2", "+400", "0x190", "400 Token", "abc", "Infinity", "NaN", "99999999999999999999"]) {
    assert.equal(readNumPredict(raw), null, raw);
  }
});

test("numPredictText: Zeile nur, wenn die Variable gesetzt ist", () => {
  assert.equal(numPredictText(undefined, null), null);
  assert.equal(numPredictText("  ", null), null);
  assert.equal(numPredictText("400", 400), "höchstens 400 Antwort-Token je Bewertung des Wächters (HUB_AGENT_VISION_NUM_PREDICT)");
  assert.equal(numPredictText(" -1 ", null), "HUB_AGENT_VISION_NUM_PREDICT „-1“ ist keine ganze Zahl ab 1 – keine Grenze");
  assert.equal(numPredictText("x".repeat(50), null), `HUB_AGENT_VISION_NUM_PREDICT „${"x".repeat(20)}“ ist keine ganze Zahl ab 1 – keine Grenze`);
});

test("answerCutOff: nur mit Grenze und done_reason length", () => {
  const length: VisionOutput = { ...NONE, contentChars: 1210, doneReason: "length" };
  assert.equal(answerCutOff(length, 400), true);
  // Ohne Grenze bleibt die Auswertung wie bisher.
  assert.equal(answerCutOff(length, null), false);
  assert.equal(answerCutOff({ ...length, doneReason: "stop" }, 400), false);
  assert.equal(answerCutOff({ ...length, doneReason: null }, 400), false);
  assert.equal(answerCutOff({ ...length, doneReason: "unload" }, 400), false);
  assert.equal(cutOffText(400), "Antwort an der Grenze von 400 Token abgebrochen (HUB_AGENT_VISION_NUM_PREDICT)");
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

test("timingLine: je Aufruf Antworttext, Denktext und done_reason", () => {
  const over = call("Übersicht", 21.2, { output: { ...NONE, contentChars: 98, blankChars: 12, doneReason: "stop" } });
  const close = call("Nahaufnahme", 67.8, {
    wallMs: 41_000,
    timing: timing({ wallMs: 41_000, totalNs: 41 * S, loadNs: 0, promptTokens: 2900, promptNs: 1.5 * S, evalTokens: 3837, evalNs: 39.5 * S }),
    output: { ...NONE, contentChars: 412, blankChars: 50, thinkingChars: 14_800, doneReason: "stop" },
  });
  assert.equal(
    timingLine("Eingang", [over, close], T0, NUM_CTX),
    "Wächter: Eingang: Bildmodell Übersicht 18,4 s (laden 0,1 s · Bild+Prompt 14,9 s/2310 Token · Antwort 3,2 s/96 Token, 98 Zeichen); " +
      "Nahaufnahme 41,0 s (laden 0,0 s · Bild+Prompt 1,5 s/2900 Token · Antwort 39,5 s/3837 Token, 412 Zeichen, Denktext 14 800 Zeichen); Auslöser bis Urteil 67,8 s"
  );
  // Ein gescheiterter Aufruf hat keinen Inhalt.
  assert.match(timingLine("Eingang", [over, call("Nahaufnahme", 141, { wallMs: 120_000, timing: null, output: null })], T0) ?? "", /Nahaufnahme gescheitert nach 120,0 s; Auslöser bis Abbruch/);
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

test("timingLine: eine an der Grenze abgebrochene Antwort steht mit Zeitangaben da und endet mit Abbruch", () => {
  const cut = call("Übersicht", 12.3, {
    wallMs: 9_150,
    timing: timing({ wallMs: 9_150, totalNs: 9.1 * S, loadNs: 0, promptTokens: 2310, promptNs: 1.1 * S, evalTokens: 400, evalNs: 8 * S }),
    output: { ...NONE, contentChars: 1210, blankChars: 150, doneReason: "length" },
    cut: true,
  });
  assert.equal(
    timingLine("Eingang", [cut], T0),
    "Wächter: Eingang: Bildmodell Übersicht an der Grenze abgebrochen 9,1 s (laden 0,0 s · Bild+Prompt 1,1 s/2310 Token · Antwort 8,0 s/400 Token, 1210 Zeichen, done_reason length); Auslöser bis Abbruch 12,3 s"
  );
  // Nahaufnahme an der Grenze abgebrochen nach beantworteter Uebersicht.
  const line = timingLine("Eingang", [call("Übersicht", 21.2), { ...cut, label: "Nahaufnahme", endedAt: T0 + 30_500 }], T0) ?? "";
  assert.match(line, /; Nahaufnahme an der Grenze abgebrochen 9,1 s \(.*done_reason length\); Auslöser bis Abbruch 30,5 s$/);
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
  // An der Grenze abgebrochen: gescheitert, dazu sentinel_model_cut, kein Urteil.
  const cut = call("Übersicht", 12, { output: { ...NONE, contentChars: 1210, doneReason: "length" }, cut: true });
  assert.deepEqual(inspectionCounters([cut], T0, NUM_CTX), ["sentinel_model_error", "sentinel_model_cut"]);
  assert.deepEqual(inspectionCounters([call("Übersicht", 21.2), { ...cut, label: "Nahaufnahme" }], T0, NUM_CTX), [
    "sentinel_model_call",
    "sentinel_model_error",
    "sentinel_model_cut",
  ]);
  // Ohne Angabe des Kontextfensters wird es nicht gezaehlt.
  assert.deepEqual(inspectionCounters([call("Übersicht", 5, { timing: timing({ promptTokens: 8192 }) })], T0, 0), ["sentinel_model_call", "sentinel_verdict"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { newWatchState, watchStep } from "./findings.js";
import {
  UNVERIFIED_NOTE,
  VISION_GRACE_MS,
  VISION_RETRY_MS,
  newVisionUpkeep,
  onVisionError,
  unverifiedText,
  visionChangeLine,
  visionErrorText,
  visionFinding,
  visionRetryDue,
  visionUpkeepStep,
  type VisionHealth,
  type VisionNow,
} from "./vision-rules.js";

const SEC = 1_000;
const MIN = 60_000;
const NIGHT = "22-6";

/* ------------------------------------------------------------ onVisionError */

test("onVisionError: Tabelle aus Auslöser, Tracker und Uhrzeit", () => {
  const rows: Array<[string, boolean, number | null, number, "alarm" | "befund"]> = [
    // Personen-Ausloeser am Tag: Es zaehlt, was der Tracker auf dem Standbild sieht.
    ["Person, Tracker sieht 1, 14 Uhr", true, 1, 14, "alarm"],
    ["Person, Tracker sieht 3, 14 Uhr", true, 3, 14, "alarm"],
    ["Person, Tracker sieht niemanden, 14 Uhr", true, 0, 14, "befund"],
    ["Person, Tracker nicht erreichbar, 14 Uhr", true, null, 14, "befund"],
    // Im Nachtfenster geht der Alarm immer hinaus.
    ["Person, Tracker sieht niemanden, 23 Uhr", true, 0, 23, "alarm"],
    ["Person, Tracker nicht erreichbar, 2 Uhr", true, null, 2, "alarm"],
    ["Person, Tracker sieht 1, 2 Uhr", true, 1, 2, "alarm"],
    ["Fahrzeug, 22 Uhr", false, null, 22, "alarm"],
    ["Fahrzeug, 5 Uhr", false, null, 5, "alarm"],
    // Raender des Nachtfensters 22–6: 21 und 6 Uhr liegen ausserhalb.
    ["Fahrzeug, 21 Uhr", false, null, 21, "befund"],
    ["Fahrzeug, 6 Uhr", false, null, 6, "befund"],
    ["Fahrzeug, 14 Uhr", false, null, 14, "befund"],
    // Der Tracker zaehlt nur bei einem Personen-Ausloeser.
    ["Fahrzeug, Tracker sieht 2, 14 Uhr", false, 2, 14, "befund"],
  ];
  for (const [name, isPerson, trackerCount, hour, want] of rows) {
    assert.equal(onVisionError({ isPerson, trackerCount, hour, nightWindow: NIGHT }), want, name);
  }
});

test("onVisionError: ohne lesbare Stunde und ohne Nachtfenster zählt nur die Person im Bild", () => {
  assert.equal(onVisionError({ isPerson: false, trackerCount: null, hour: NaN, nightWindow: NIGHT }), "befund");
  assert.equal(onVisionError({ isPerson: true, trackerCount: 0, hour: NaN, nightWindow: NIGHT }), "befund");
  assert.equal(onVisionError({ isPerson: true, trackerCount: 1, hour: NaN, nightWindow: NIGHT }), "alarm");
  assert.equal(onVisionError({ isPerson: false, trackerCount: null, hour: 23, nightWindow: "" }), "befund");
  assert.equal(onVisionError({ isPerson: true, trackerCount: 2, hour: 23, nightWindow: "" }), "alarm");
});

test("unverifiedText: nennt Auslöser, Tracker und den Vermerk", () => {
  assert.equal(UNVERIFIED_NOTE, "ungeprüft, Bildmodell nicht erreichbar");
  assert.equal(unverifiedText(true, 1), "Person von der Kamera gemeldet (Tracker sieht 1 Person) – ungeprüft, Bildmodell nicht erreichbar");
  assert.equal(unverifiedText(true, 3), "Person von der Kamera gemeldet (Tracker sieht 3 Personen) – ungeprüft, Bildmodell nicht erreichbar");
  assert.equal(unverifiedText(true, 0), "Person von der Kamera gemeldet (Tracker sieht niemanden) – ungeprüft, Bildmodell nicht erreichbar");
  assert.equal(unverifiedText(true, null), "Person von der Kamera gemeldet – ungeprüft, Bildmodell nicht erreichbar");
  assert.equal(unverifiedText(false, null), "Fahrzeug von der Kamera gemeldet – ungeprüft, Bildmodell nicht erreichbar");
  assert.equal(unverifiedText(false, 2), "Fahrzeug von der Kamera gemeldet – ungeprüft, Bildmodell nicht erreichbar");
});

/* ------------------------------------------------------------ Befund */

const health = (o: Partial<VisionHealth> = {}): VisionHealth => ({
  enabled: true,
  sentinel: true,
  ready: true,
  sinceMs: 10 * MIN,
  installing: false,
  error: null,
  failStreak: 0,
  lastError: null,
  ...o,
});

test("visionFinding: bereit und ohne Fehler gibt es keinen Befund, abgeschaltet auch nicht", () => {
  assert.equal(visionFinding(health()), null);
  assert.equal(visionFinding(health({ enabled: false, ready: false, sinceMs: 60 * MIN })), null);
  assert.equal(visionFinding(health({ enabled: false, failStreak: 5 })), null);
});

test("visionFinding: nicht bereit ist nach einer Minute ein Alarm mit dem Grund", () => {
  assert.equal(visionFinding(health({ ready: false, sinceMs: VISION_GRACE_MS - 1 })), null);
  assert.deepEqual(visionFinding(health({ ready: false, sinceMs: VISION_GRACE_MS, error: "Ollama antwortet nicht unter http://127.0.0.1:11434" })), {
    key: "vision",
    severity: "alert",
    title: "Bildmodell nicht bereit",
    detail: "Ollama antwortet nicht unter http://127.0.0.1:11434. Der Wächter mit Bildern bewertet so lange keine Kamera-Ereignisse.",
  });
  assert.equal(
    visionFinding(health({ ready: false, installing: true, error: "alter Grund" }))?.detail,
    "Das Modell wird gerade geladen. Der Wächter mit Bildern bewertet so lange keine Kamera-Ereignisse."
  );
  assert.equal(visionFinding(health({ ready: false }))?.detail, "Grund unbekannt. Der Wächter mit Bildern bewertet so lange keine Kamera-Ereignisse.");
});

test("visionFinding: antwortet nicht, ab dem ersten Fehler in Folge, mit Zahl und letztem Fehler", () => {
  assert.deepEqual(visionFinding(health({ failStreak: 1, lastError: "Zeitüberschreitung" })), {
    key: "vision",
    severity: "alert",
    title: "Bildmodell antwortet nicht (1 Fehler in Folge)",
    detail: "Zeitüberschreitung. Bei einer Person im Bild und im Nachtfenster geht der Alarm ungeprüft hinaus.",
  });
  const four = visionFinding(health({ failStreak: 4, lastError: "Ollama nicht erreichbar (ECONNREFUSED)" }));
  assert.equal(four?.title, "Bildmodell antwortet nicht (4 Fehler in Folge)");
  assert.equal(four?.detail, "Ollama nicht erreichbar (ECONNREFUSED). Bei einer Person im Bild und im Nachtfenster geht der Alarm ungeprüft hinaus.");
  assert.equal(visionFinding(health({ failStreak: 2 }))?.detail, "Grund unbekannt. Bei einer Person im Bild und im Nachtfenster geht der Alarm ungeprüft hinaus.");
  // Nicht bereit geht vor: Dann wird gar nicht bewertet.
  assert.equal(visionFinding(health({ ready: false, failStreak: 4 }))?.title, "Bildmodell nicht bereit");
});

test("visionFinding: ist der Wächter mit Bildern aus, ist es eine Warnung ohne den Satz zum Wächter", () => {
  assert.deepEqual(visionFinding(health({ sentinel: false, ready: false, error: "Modell laden: HTTP 500" })), {
    key: "vision",
    severity: "warn",
    title: "Bildmodell nicht bereit",
    detail: "Modell laden: HTTP 500.",
  });
  assert.deepEqual(visionFinding(health({ sentinel: false, failStreak: 2, lastError: "Zeitüberschreitung" })), {
    key: "vision",
    severity: "warn",
    title: "Bildmodell antwortet nicht (2 Fehler in Folge)",
    detail: "Zeitüberschreitung.",
  });
});

test("visionFinding im Zustands-Wächter: sofort gemeldet, auch in der Ruhezeit; wechselt der Grund, keine zweite Meldung; danach Entwarnung", () => {
  const st = newWatchState();
  const t0 = 1_000_000;
  const check = (h: VisionHealth, min: number, quiet: boolean) => {
    const f = visionFinding(h);
    return watchStep(st, f ? [f] : [], t0 + min * MIN, quiet);
  };
  // Erste Pruefung, Ruhezeit: Der Alarm geht trotzdem sofort hinaus.
  let step = check(health({ ready: false, error: "Ollama antwortet nicht unter http://127.0.0.1:11434" }), 0, true);
  assert.deepEqual(
    step.announce.map((f) => f.title),
    ["Bildmodell nicht bereit"]
  );
  assert.equal(step.deferredNow.length, 0);
  // Wieder bereit, aber die Aufrufe scheitern: derselbe Befund, keine neue Meldung.
  step = check(health({ failStreak: 2, lastError: "Zeitüberschreitung" }), 5, true);
  assert.deepEqual([step.announce.length, step.resolved.length], [0, 0]);
  step = check(health({ failStreak: 5, lastError: "Zeitüberschreitung" }), 10, false);
  assert.deepEqual([step.announce.length, step.resolved.length], [0, 0]);
  // Der erste gelungene Aufruf setzt den Zaehler zurueck: Entwarnung mit der Dauer ab der ersten Meldung.
  step = check(health(), 15, false);
  assert.equal(step.announce.length, 0);
  assert.deepEqual(
    step.resolved.map((f) => [f.title, f.sinceMs]),
    [["Bildmodell antwortet nicht (5 Fehler in Folge)", 15 * MIN]]
  );
});

test("visionFinding im Zustands-Wächter: als Warnung (Wächter mit Bildern aus) erst nach zwei Prüfungen, in der Ruhezeit am Morgen", () => {
  const st = newWatchState();
  const f = visionFinding(health({ sentinel: false, ready: false, error: "Modell laden: HTTP 500" }));
  assert.ok(f);
  assert.equal(watchStep(st, [f], 0, true).announce.length, 0);
  const second = watchStep(st, [f], 5 * MIN, true);
  assert.deepEqual([second.announce.length, second.deferredNow.length], [0, 1]);
  assert.deepEqual(
    watchStep(st, [f], 10 * MIN, false).announce.map((x) => x.title),
    ["Bildmodell nicht bereit"]
  );
});

test("visionErrorText: Zeitüberschreitung und Verbindungsfehler in Worten, sonst die erste Zeile", () => {
  assert.equal(visionErrorText(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), "Zeitüberschreitung");
  assert.equal(visionErrorText(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })), "Zeitüberschreitung");
  assert.equal(visionErrorText(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), "Ollama nicht erreichbar (ECONNREFUSED)");
  assert.equal(visionErrorText(new TypeError("fetch failed")), "Ollama nicht erreichbar");
  assert.equal(visionErrorText(new Error("model requires more system memory\nDetails in der zweiten Zeile")), "model requires more system memory");
  assert.equal(visionErrorText(new Error("Ollama HTTP 500")), "Ollama HTTP 500");
  assert.equal(visionErrorText("kaputt"), "kaputt");
});

/* ------------------------------------------------------------ Wiederanlauf */

test("visionRetryDue: nur wenn nicht bereit, nie neben einem laufenden Versuch, höchstens alle 5 Minuten", () => {
  const t0 = 5_000_000;
  assert.equal(visionRetryDue({ ready: true, busy: false, lastTryAt: null, now: t0 }), false);
  assert.equal(visionRetryDue({ ready: false, busy: true, lastTryAt: null, now: t0 }), false);
  assert.equal(visionRetryDue({ ready: false, busy: false, lastTryAt: null, now: t0 }), true);
  assert.equal(visionRetryDue({ ready: false, busy: false, lastTryAt: t0, now: t0 + VISION_RETRY_MS - 1 }), false);
  assert.equal(visionRetryDue({ ready: false, busy: false, lastTryAt: t0, now: t0 + VISION_RETRY_MS }), true);
  assert.equal(VISION_RETRY_MS, 5 * MIN);
});

const state = (o: Partial<VisionNow> = {}): VisionNow => ({ ready: false, sinceMs: 5 * MIN, busy: false, error: null, ...o });

test("visionChangeLine: eine Zeile, wenn das Bildmodell ausfällt, eine, wenn es wieder bereit ist", () => {
  // Start des Hubs: In der ersten Minute ist „nicht bereit“ keine Zeile.
  assert.deepEqual(visionChangeLine(false, state({ sinceMs: VISION_GRACE_MS - 1 })), { down: false, line: null });
  assert.deepEqual(visionChangeLine(false, state({ ready: true, sinceMs: 3 * SEC })), { down: false, line: null });
  const down = visionChangeLine(false, state({ sinceMs: VISION_GRACE_MS, error: "Ollama antwortet nicht unter http://127.0.0.1:11434" }));
  assert.deepEqual(down, {
    down: true,
    line: "Wächter: Bildmodell nicht bereit (Ollama antwortet nicht unter http://127.0.0.1:11434), Kamera-Ereignisse werden so lange nicht bewertet; Wiederanlauf alle 5 Minuten",
  });
  assert.match(visionChangeLine(false, state({ busy: true, error: "alter Grund" })).line ?? "", /\(wird gerade geladen\)/);
  assert.match(visionChangeLine(false, state()).line ?? "", /\(Grund unbekannt\)/);
  // Bleibt es ausgefallen, kommt keine weitere Zeile, auch wenn sich der Grund aendert.
  assert.deepEqual(visionChangeLine(true, state({ error: "Modell laden: HTTP 500" })), { down: true, line: null });
  assert.deepEqual(visionChangeLine(true, state({ ready: true, sinceMs: 0 })), {
    down: false,
    line: "Wächter: Bildmodell wieder bereit, Kamera-Ereignisse werden wieder bewertet",
  });
});

/**
 * Takt des Waechters mit einer Attrappe fuer das Bereitstellen: alle 3 s ein
 * Takt; jeder Versuch dauert `takesSec` und gelingt ab dem `okFrom`-ten.
 */
function runUpkeep(o: { minutes: number; takesSec: number; okFrom: number; readyAtStart?: boolean; dropAtMin?: number; sentinel?: boolean }) {
  const st = newVisionUpkeep();
  const t0 = 10_000_000;
  let ready = o.readyAtStart ?? false;
  let since = t0;
  let busyUntil: number | null = null;
  let attempts = 0;
  let error: string | null = null;
  const tries: number[] = [];
  const lines: string[] = [];
  for (let now = t0; now <= t0 + o.minutes * MIN; now += 3 * SEC) {
    // Ein laufender Versuch endet.
    if (busyUntil !== null && now >= busyUntil) {
      busyUntil = null;
      if (attempts >= o.okFrom) {
        ready = true;
        since = now;
        error = null;
      } else {
        error = "Ollama antwortet nicht unter http://127.0.0.1:11434";
      }
    }
    // Das Modell faellt im Betrieb weg (Antwort „Modell nicht gefunden“).
    if (o.dropAtMin !== undefined && now === t0 + o.dropAtMin * MIN) {
      ready = false;
      since = now;
    }
    const step = visionUpkeepStep(st, { ready, sinceMs: now - since, busy: busyUntil !== null, error }, now, o.sentinel ?? true);
    if (step.line) lines.push(`${Math.round((now - t0) / SEC)} s ${step.line}`);
    if (step.retry) {
      attempts++;
      tries.push(Math.round((now - t0) / SEC));
      busyUntil = now + o.takesSec * SEC;
    }
  }
  return { tries, lines, ready };
}

test("Takt: Bildmodell nicht bereit, der Takt stellt es alle 5 Minuten neu bereit, bis es gelingt", () => {
  const r = runUpkeep({ minutes: 30, takesSec: 2, okFrom: 4 });
  // Versuche bei 0, 5, 10 und 15 Minuten; der vierte gelingt, danach keiner mehr.
  assert.deepEqual(r.tries, [0, 300, 600, 900]);
  assert.equal(r.ready, true);
  assert.deepEqual(r.lines, [
    "60 s Wächter: Bildmodell nicht bereit (Ollama antwortet nicht unter http://127.0.0.1:11434), Kamera-Ereignisse werden so lange nicht bewertet; Wiederanlauf alle 5 Minuten",
    "903 s Wächter: Bildmodell wieder bereit, Kamera-Ereignisse werden wieder bewertet",
  ]);
});

test("Takt: bleibt das Bildmodell aus, gibt es höchstens einen Versuch je 5 Minuten und nur eine Zeile", () => {
  const r = runUpkeep({ minutes: 60, takesSec: 2, okFrom: 999 });
  assert.equal(r.tries.length, 13);
  for (let i = 1; i < r.tries.length; i++) assert.ok(r.tries[i] - r.tries[i - 1] >= 300, `Abstand ${r.tries[i] - r.tries[i - 1]} s`);
  assert.equal(r.lines.length, 1);
});

test("Takt: solange ein Versuch läuft (Modell wird geladen), beginnt kein zweiter", () => {
  // Das Laden dauert 12 Minuten und gelingt.
  const r = runUpkeep({ minutes: 30, takesSec: 12 * 60, okFrom: 1 });
  assert.deepEqual(r.tries, [0]);
  assert.deepEqual(r.lines, [
    "60 s Wächter: Bildmodell nicht bereit (wird gerade geladen), Kamera-Ereignisse werden so lange nicht bewertet; Wiederanlauf alle 5 Minuten",
    "720 s Wächter: Bildmodell wieder bereit, Kamera-Ereignisse werden wieder bewertet",
  ]);
});

test("Takt: fällt das Modell im Betrieb weg, beginnt der Wiederanlauf im selben Takt; binnen einer Minute zurück heißt keine Zeile", () => {
  const r = runUpkeep({ minutes: 30, takesSec: 20, okFrom: 1, readyAtStart: true, dropAtMin: 10 });
  assert.deepEqual(r.tries, [600]);
  assert.equal(r.ready, true);
  assert.deepEqual(r.lines, []);
});

test("Takt: bereit heißt kein Versuch und keine Zeile; ohne Wächter mit Bildern wird neu bereitgestellt, aber nichts geloggt", () => {
  assert.deepEqual(runUpkeep({ minutes: 30, takesSec: 2, okFrom: 1, readyAtStart: true }), { tries: [], lines: [], ready: true });
  const off = runUpkeep({ minutes: 20, takesSec: 2, okFrom: 3, sentinel: false });
  assert.deepEqual(off.tries, [0, 300, 600]);
  assert.deepEqual(off.lines, []);
});

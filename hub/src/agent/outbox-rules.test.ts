import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AGE_MS,
  MAX_WAITING,
  OPEN_AT_EXIT,
  OPEN_AT_EXIT_SEEN,
  UNDELIVERED_KEEP_MS,
  UNDELIVERED_MAX,
  acceptsMessage,
  addUndelivered,
  afterFailure,
  attemptMode,
  classifyFailure,
  deliveryCounter,
  deliveryLine,
  dueAgain,
  durationText,
  markSeenAtExit,
  restoreUndelivered,
  retryDelayMs,
  serializeUndelivered,
  undeliveredFinding,
  type FailedAttempt,
  type SendFailure,
  type UndeliveredAlarm,
} from "./outbox-rules.js";

const SEC = 1000;
const MIN = 60 * SEC;
const T0 = 1_000_000;

/** Fehler, wie telegram.ts ihn wirft, wenn Telegram mit einem Fehler antwortet. */
const http = (status: number, text: string, retryAfterSec: number | null = null) =>
  Object.assign(new Error(`Telegram sendPhoto: ${text}`), { status, retryAfterSec });

const NETZ: SendFailure = { retry: true, retryAfterMs: 0, reason: "fetch failed" };
const ABGELEHNT: SendFailure = { retry: false, retryAfterMs: 0, reason: "Bad Request" };

const failed = (o: Partial<FailedAttempt> = {}): FailedAttempt => ({
  tries: 1,
  queuedAt: T0,
  now: T0,
  maxAgeMs: MAX_AGE_MS,
  withPhoto: true,
  textFallback: true,
  ...o,
});

/* ------------------------------------------------------------ Plan */

test("Plan: der erste Versuch sofort, dann nach 5 s, 20 s, 60 s und alle 3 Minuten", () => {
  assert.equal(retryDelayMs(0), 0);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(retryDelayMs), [5 * SEC, 20 * SEC, 60 * SEC, 3 * MIN, 3 * MIN, 3 * MIN]);
  assert.equal(retryDelayMs(NaN), 0);
  assert.equal(retryDelayMs(-1), 0);
  assert.equal(MAX_AGE_MS, 15 * MIN);
});

/* ------------------------------------------------------------ Fehler einordnen */

test("Fehler: Netzfehler und Zeitüberschreitung werden wiederholt", () => {
  const netz = classifyFailure(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }));
  assert.deepEqual(netz, { retry: true, retryAfterMs: 0, reason: "fetch failed (ENOTFOUND)" });
  assert.deepEqual(classifyFailure(new TypeError("fetch failed")), { retry: true, retryAfterMs: 0, reason: "fetch failed" });
  const timeout = classifyFailure(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  assert.deepEqual(timeout, { retry: true, retryAfterMs: 0, reason: "Zeitüberschreitung" });
  assert.equal(classifyFailure(new DOMException("This operation was aborted", "AbortError")).retry, true);
  // Auch was kein Fehlerobjekt ist, gilt als „keine Antwort“.
  assert.deepEqual(classifyFailure("kaputt"), { retry: true, retryAfterMs: 0, reason: "kaputt" });
  assert.equal(classifyFailure(null).retry, true);
  assert.equal(classifyFailure(undefined).retry, true);
});

test("Fehler: HTTP 5xx wird wiederholt, 4xx nicht", () => {
  for (const status of [500, 502, 503, 504]) assert.equal(classifyFailure(http(status, "Bad Gateway")).retry, true, String(status));
  for (const status of [400, 401, 403, 404, 413]) assert.equal(classifyFailure(http(status, "Bad Request")).retry, false, String(status));
  assert.equal(classifyFailure(http(403, "Forbidden: bot was blocked by the user")).reason, "Telegram sendPhoto: Forbidden: bot was blocked by the user");
  // Antwort ohne Fehlerstatus, die nicht zu lesen war: wie ein Netzfehler.
  assert.equal(classifyFailure(http(200, "HTTP 200")).retry, true);
  assert.equal(classifyFailure(http(302, "HTTP 302")).retry, true);
});

test("Fehler: 429 wird wiederholt, mit der Wartezeit, die Telegram nennt", () => {
  assert.deepEqual(classifyFailure(http(429, "Too Many Requests: retry after 35", 35)), {
    retry: true,
    retryAfterMs: 35 * SEC,
    reason: "Telegram sendPhoto: Too Many Requests: retry after 35",
  });
  assert.equal(classifyFailure(http(429, "Too Many Requests")).retryAfterMs, 0);
  assert.equal(classifyFailure(http(429, "Too Many Requests", -3)).retryAfterMs, 0);
  // Eine Wartezeit an einem anderen Fehler zaehlt nicht.
  assert.equal(classifyFailure(http(500, "Internal Server Error", 35)).retryAfterMs, 0);
});

/* ------------------------------------------------------------ Bild oder Text */

test("Versuch: mit Bild, solange die Frist läuft; der letzte Versuch eines Alarms geht als Text", () => {
  const base = { hasPhoto: true, textOnly: false, textFallback: true, queuedAt: T0, maxAgeMs: MAX_AGE_MS };
  assert.equal(attemptMode({ ...base, now: T0 }), "foto");
  assert.equal(attemptMode({ ...base, now: T0 + MAX_AGE_MS - 1 }), "foto");
  assert.equal(attemptMode({ ...base, now: T0 + MAX_AGE_MS }), "text");
  assert.equal(attemptMode({ ...base, now: T0 + MAX_AGE_MS + 5 * MIN }), "text");
  // Ein Zusatzbild hat ohne Bild nichts zu sagen: Es bleibt beim Bild.
  assert.equal(attemptMode({ ...base, textFallback: false, now: T0 + MAX_AGE_MS }), "foto");
  // Hat Telegram das Bild abgelehnt, geht es ab dann ohne.
  assert.equal(attemptMode({ ...base, textOnly: true, now: T0 }), "text");
  assert.equal(attemptMode({ ...base, hasPhoto: false, now: T0 }), "text");
});

/* ------------------------------------------------------------ Nach einem Fehlschlag */

test("Abgelehnt: ein Alarm geht sofort als Text hinaus, alles andere ist nicht zustellbar", () => {
  assert.deepEqual(afterFailure(failed({ now: T0 + 300 }), ABGELEHNT), { then: "text", at: T0 + 300 });
  assert.deepEqual(afterFailure(failed({ textFallback: false }), ABGELEHNT), { then: "give_up" });
  // Auch der Text wurde abgelehnt.
  assert.deepEqual(afterFailure(failed({ withPhoto: false }), ABGELEHNT), { then: "give_up" });
});

test("Netzfehler: nächster Versuch nach Plan, mit demselben Inhalt", () => {
  assert.deepEqual(afterFailure(failed({ tries: 1 }), NETZ), { then: "retry", at: T0 + 5 * SEC });
  assert.deepEqual(afterFailure(failed({ tries: 2, now: T0 + 5 * SEC }), NETZ), { then: "retry", at: T0 + 25 * SEC });
  assert.deepEqual(afterFailure(failed({ tries: 3, now: T0 + 25 * SEC }), NETZ), { then: "retry", at: T0 + 85 * SEC });
  assert.deepEqual(afterFailure(failed({ tries: 4, now: T0 + 85 * SEC }), NETZ), { then: "retry", at: T0 + 265 * SEC });
  assert.deepEqual(afterFailure(failed({ tries: 5, now: T0 + 265 * SEC }), NETZ), { then: "retry", at: T0 + 445 * SEC });
  // Fuer Text gilt derselbe Plan.
  assert.deepEqual(afterFailure(failed({ tries: 2, withPhoto: false, textFallback: false, now: T0 + 7 * SEC }), NETZ), { then: "retry", at: T0 + 27 * SEC });
});

test("429: nie vor der Wartezeit, die Telegram nennt", () => {
  const limit = (sec: number): SendFailure => ({ retry: true, retryAfterMs: sec * SEC, reason: "Too Many Requests" });
  assert.deepEqual(afterFailure(failed({ tries: 1 }), limit(35)), { then: "retry", at: T0 + 35 * SEC });
  // Der Plan wartet ohnehin laenger.
  assert.deepEqual(afterFailure(failed({ tries: 3 }), limit(2)), { then: "retry", at: T0 + 60 * SEC });
  // Die Wartezeit reicht ueber die Frist hinaus: aufgeben.
  assert.deepEqual(afterFailure(failed({ tries: 1 }), limit(16 * 60)), { then: "give_up" });
  assert.deepEqual(afterFailure(failed({ tries: 6, now: T0 + 14 * MIN }), limit(90)), { then: "give_up" });
  // Sie endet vor der Frist, der Plan danach: ein letzter Versuch am Ende der Frist.
  assert.deepEqual(afterFailure(failed({ tries: 6, now: T0 + 14 * MIN }), limit(30)), { then: "retry", at: T0 + MAX_AGE_MS });
});

test("Frist: ein letzter Versuch an ihrem Ende, danach keiner mehr", () => {
  assert.deepEqual(afterFailure(failed({ tries: 8, now: T0 + 805 * SEC }), NETZ), { then: "retry", at: T0 + MAX_AGE_MS });
  assert.deepEqual(afterFailure(failed({ tries: 7, now: T0 + MAX_AGE_MS - 1 }), NETZ), { then: "retry", at: T0 + MAX_AGE_MS });
  // Der letzte Versuch eines Alarms ging als Text hinaus (attemptMode) und ist gescheitert.
  assert.deepEqual(afterFailure(failed({ tries: 9, now: T0 + MAX_AGE_MS, withPhoto: false }), NETZ), { then: "give_up" });
  // Meldung und Zusatzbild haben keinen Rueckfall: Mit der Frist ist Schluss.
  assert.deepEqual(afterFailure(failed({ tries: 9, now: T0 + MAX_AGE_MS, withPhoto: false, textFallback: false }), NETZ), { then: "give_up" });
  assert.deepEqual(afterFailure(failed({ tries: 9, now: T0 + MAX_AGE_MS + 60 * SEC, textFallback: false }), NETZ), { then: "give_up" });
});

test("Frist: Scheitert ein Versuch mit Bild erst nach ihrem Ende, geht der Alarm sofort noch einmal als Text hinaus", () => {
  const late = T0 + MAX_AGE_MS + 40 * SEC;
  assert.deepEqual(afterFailure(failed({ tries: 7, now: late }), NETZ), { then: "text", at: late });
  assert.deepEqual(afterFailure(failed({ tries: 1, now: late }), NETZ), { then: "text", at: late });
  assert.deepEqual(afterFailure(failed({ tries: 7, now: T0 + MAX_AGE_MS }), NETZ), { then: "text", at: T0 + MAX_AGE_MS });
  // Dieser Versuch als Text ist der letzte.
  assert.deepEqual(afterFailure(failed({ tries: 8, now: late + 20 * SEC, withPhoto: false }), NETZ), { then: "give_up" });
  // Verlangt Telegram eine Pause, liegt sie hinter der Frist: aufgeben.
  assert.deepEqual(afterFailure(failed({ tries: 7, now: late }), { retry: true, retryAfterMs: 30 * SEC, reason: "Too Many Requests" }), { then: "give_up" });
  assert.deepEqual(afterFailure(failed({ tries: 7, now: late }), { retry: true, retryAfterMs: 0, reason: "Too Many Requests" }), { then: "text", at: late });
});

/**
 * Dauerausfall eines Alarms nach den Regeln durchspielen: Jeder Versuch
 * scheitert nach `takesMs` mit einem Netzfehler. Liefert Beginn (in Sekunden)
 * und Art jedes Versuchs.
 */
function outage(takesMs: number): { starts: number[]; modes: string[] } {
  const starts: number[] = [];
  const modes: string[] = [];
  let now = T0;
  let textOnly = false;
  for (let tries = 1; tries < 50; tries++) {
    const mode = attemptMode({ hasPhoto: true, textOnly, textFallback: true, queuedAt: T0, now, maxAgeMs: MAX_AGE_MS });
    starts.push((now - T0) / SEC);
    modes.push(mode);
    now += takesMs;
    const next = afterFailure(failed({ tries, now, withPhoto: mode === "foto" }), NETZ);
    if (next.then === "give_up") break;
    if (next.then === "text") textOnly = true;
    now = next.at;
  }
  return { starts, modes };
}

test("Dauerausfall: Versuche bei 0, 5, 25, 85, 265, 445, 625, 805 und 900 s, der letzte ohne Bild", () => {
  const { starts, modes } = outage(0);
  assert.deepEqual(starts, [0, 5, 25, 85, 265, 445, 625, 805, 900]);
  assert.deepEqual(modes, ["foto", "foto", "foto", "foto", "foto", "foto", "foto", "foto", "text"]);
});

test("Dauerausfall mit Zeitüberschreitung je Versuch (60 s): kein Versuch beginnt nach der Frist", () => {
  const { starts, modes } = outage(60 * SEC);
  assert.deepEqual(starts, [0, 65, 145, 265, 505, 745, 900]);
  assert.deepEqual(modes, ["foto", "foto", "foto", "foto", "foto", "foto", "text"]);
});

test("Dauerausfall mit 45 s je Versuch: Der Versuch mit Bild von 895 s endet nach der Frist, danach geht der Alarm einmal als Text hinaus", () => {
  const { starts, modes } = outage(45 * SEC);
  assert.deepEqual(starts, [0, 50, 115, 220, 445, 670, 895, 940]);
  assert.deepEqual(modes, ["foto", "foto", "foto", "foto", "foto", "foto", "foto", "text"]);
  const short = outage(12.5 * SEC);
  assert.deepEqual(short.starts, [0, 17.5, 50, 122.5, 315, 507.5, 700, 892.5, 905]);
  assert.deepEqual(short.modes.slice(-2), ["foto", "text"]);
});

test("Dauerausfall: Bei jeder Dauer je Versuch hat der Alarm genau einen letzten Versuch als Text", () => {
  for (let half = 0; half <= 150; half++) {
    const takesMs = half * 500;
    const { starts, modes } = outage(takesMs);
    const label = `${takesMs / SEC} s je Versuch`;
    assert.equal(modes[modes.length - 1], "text", label);
    assert.equal(modes.filter((m) => m === "text").length, 1, label);
    // Kein Versuch mit Bild beginnt nach der Frist; der Text beginnt spaetestens, wenn der letzte Versuch mit Bild gescheitert ist.
    assert.ok(starts.slice(0, -1).every((s) => s * SEC < MAX_AGE_MS), label);
    assert.ok(starts[starts.length - 1] * SEC <= MAX_AGE_MS + takesMs, label);
  }
});

/* ------------------------------------------------------------ Volle Reihe */

test("Volle Reihe: nur Zusatzbilder werden abgewiesen", () => {
  assert.equal(acceptsMessage(0, true), true);
  assert.equal(acceptsMessage(MAX_WAITING - 1, true), true);
  assert.equal(acceptsMessage(MAX_WAITING, true), false);
  assert.equal(acceptsMessage(MAX_WAITING, false), true);
  assert.equal(acceptsMessage(10 * MAX_WAITING, false), true);
});

/* ------------------------------------------------------------ Log und Zähler */

test("Log: beim ersten Versuch zugestellt steht nur im Zähler", () => {
  const r = { ok: true, tries: 1, ms: 800, asText: false, photoError: null } as const;
  assert.equal(deliveryLine("Wächter: Alarm Eingang", r), null);
  assert.equal(deliveryCounter(r), "ok");
});

test("Log: Zustellung nach mehreren Versuchen", () => {
  const r = { ok: true, tries: 3, ms: 25_300, asText: false, photoError: null } as const;
  assert.equal(deliveryLine("Wächter: Alarm Eingang", r), "Wächter: Alarm Eingang zugestellt nach 3 Versuchen (25 s)");
  assert.equal(deliveryCounter(r), "retry");
});

test("Log: als Text ohne Bild zugestellt, mit dem Grund", () => {
  const sofort = { ok: true, tries: 2, ms: 900, asText: true, photoError: "Telegram sendPhoto: Bad Request: PHOTO_INVALID_DIMENSIONS" } as const;
  assert.equal(
    deliveryLine("Wächter: Alarm Eingang", sofort),
    "Wächter: Alarm Eingang als Text ohne Bild zugestellt nach 2 Versuchen (1 s), Foto: Telegram sendPhoto: Bad Request: PHOTO_INVALID_DIMENSIONS"
  );
  assert.equal(deliveryCounter(sofort), "text");
  const spaet = { ok: true, tries: 1, ms: 16 * MIN, asText: true, photoError: null } as const;
  assert.equal(deliveryLine("Wächter: Alarm Eingang", spaet), "Wächter: Alarm Eingang als Text ohne Bild zugestellt, Foto: Frist abgelaufen");
});

test("Log: nicht zugestellt, mit Zahl der Versuche und Grund", () => {
  const r = { ok: false, tries: 9, ms: 15 * MIN, reason: "fetch failed (ENOTFOUND)", permanent: false } as const;
  assert.equal(deliveryLine("Wächter: Alarm Eingang", r), "Wächter: Alarm Eingang NICHT zugestellt nach 9 Versuchen (15 min 0 s): fetch failed (ENOTFOUND)");
  assert.equal(deliveryCounter(r), "failed");
  assert.equal(
    deliveryLine("Zustands-Wächter: Meldung", { ok: false, tries: 1, ms: 300, reason: "Telegram sendMessage: Forbidden", permanent: true }),
    "Zustands-Wächter: Meldung NICHT zugestellt nach 1 Versuch: Telegram sendMessage: Forbidden"
  );
  // Hat die Nachricht vor ihrem einzigen Versuch in der Reihe gewartet, steht die Zeit dabei.
  assert.equal(
    deliveryLine("Zustands-Wächter: Meldung", { ok: false, tries: 1, ms: 15 * MIN, reason: "fetch failed", permanent: false }),
    "Zustands-Wächter: Meldung NICHT zugestellt nach 1 Versuch (15 min 0 s): fetch failed"
  );
  // Gar nicht erst versucht (Reihe voll, Hub wird beendet).
  assert.equal(
    deliveryLine("Wächter: Bild Eingang · +4 s", { ok: false, tries: 0, ms: 0, reason: "Hub wird beendet", permanent: false }),
    "Wächter: Bild Eingang · +4 s NICHT zugestellt: Hub wird beendet"
  );
});

test("Dauer als Text", () => {
  assert.equal(durationText(0), "0 s");
  assert.equal(durationText(25_400), "25 s");
  assert.equal(durationText(59_600), "1 min 0 s");
  assert.equal(durationText(265 * SEC), "4 min 25 s");
  assert.equal(durationText(-5), "0 s");
});

test("Höchstens eine Zeile je Stunde", () => {
  const HOUR = 60 * MIN;
  assert.equal(dueAgain(null, T0, HOUR), true);
  assert.equal(dueAgain(T0, T0 + HOUR - 1, HOUR), false);
  assert.equal(dueAgain(T0, T0 + HOUR, HOUR), true);
});

/* ------------------------------------- Alarme, die niemanden erreicht haben */

/** 22.11.2026, 14:05 Ortszeit. */
const ALARM_AT = Date.UTC(2026, 10, 22, 13, 5);
const lost = (camera: string, minutesLater = 0): UndeliveredAlarm => ({
  camera,
  at: ALARM_AT + minutesLater * MIN,
  failedAt: ALARM_AT + minutesLater * MIN + MAX_AGE_MS,
  reason: "fetch failed",
});

test("Befund: ohne nicht zugestellten Alarm keiner", () => {
  assert.equal(undeliveredFinding([], ALARM_AT), null);
});

test("Befund: ein Alarm ohne Zustellung wird sofort gemeldet, als Ereignis ohne Entwarnung", () => {
  const f = undeliveredFinding([lost("Eingang")], ALARM_AT + 16 * MIN);
  assert.deepEqual(f, {
    key: `alarm-undelivered:${ALARM_AT + MAX_AGE_MS}`,
    severity: "alert",
    event: true,
    title: "Wächter-Alarm nicht zugestellt: Eingang 14:05",
    detail: "fetch failed. Text und Bild stehen in der Zentrale unter KI.",
  });
});

test("Befund: ein weiterer nicht zugestellter Alarm ist ein neuer Befund mit allen offenen im Titel", () => {
  const first = undeliveredFinding([lost("Eingang")], ALARM_AT + 16 * MIN);
  const list = addUndelivered([lost("Eingang")], lost("Shop", 20), ALARM_AT + 36 * MIN);
  const second = undeliveredFinding(list, ALARM_AT + 36 * MIN);
  assert.notEqual(second?.key, first?.key);
  assert.equal(second?.title, "2 Wächter-Alarme nicht zugestellt: Eingang 14:05, Shop 14:25");
});

test("Befund: fällt 12 Stunden nach dem Fehlschlag weg; der Schlüssel der übrigen bleibt", () => {
  const list = [lost("Eingang"), lost("Shop", 20)];
  const before = undeliveredFinding(list, ALARM_AT + MAX_AGE_MS + UNDELIVERED_KEEP_MS - 1);
  assert.equal(before?.title, "2 Wächter-Alarme nicht zugestellt: Eingang 14:05, Shop 14:25");
  const after = undeliveredFinding(list, ALARM_AT + MAX_AGE_MS + UNDELIVERED_KEEP_MS);
  assert.equal(after?.title, "Wächter-Alarm nicht zugestellt: Shop 14:25");
  assert.equal(after?.key, before?.key);
  assert.equal(undeliveredFinding(list, ALARM_AT + 20 * MIN + MAX_AGE_MS + UNDELIVERED_KEEP_MS), null);
});

test("Befund: der Titel nennt höchstens die fünf jüngsten, die Liste höchstens 20", () => {
  let list: UndeliveredAlarm[] = [];
  for (let i = 0; i < 30; i++) list = addUndelivered(list, lost(`Kamera ${i}`, i), ALARM_AT + 60 * MIN);
  assert.equal(list.length, UNDELIVERED_MAX);
  assert.equal(list[0].camera, "Kamera 10");
  const f = undeliveredFinding(list, ALARM_AT + 60 * MIN);
  assert.equal(f?.title, "20 Wächter-Alarme nicht zugestellt: … Kamera 25 14:30, Kamera 26 14:31, Kamera 27 14:32, Kamera 28 14:33, Kamera 29 14:34");
});

test("Neustart: die Liste übersteht das Speichern und Laden, der Befund behält seinen Schlüssel", () => {
  const list = [lost("Eingang"), lost("Shop", 20)];
  const now = ALARM_AT + 40 * MIN;
  const back = restoreUndelivered(serializeUndelivered(list), now);
  assert.deepEqual(back, list);
  assert.deepEqual(undeliveredFinding(back, now), undeliveredFinding(list, now));
});

test("Neustart: abgelaufene, unvollständige und künftige Einträge werden nicht übernommen", () => {
  const now = ALARM_AT + MAX_AGE_MS + UNDELIVERED_KEEP_MS + MIN;
  const json = JSON.stringify({
    v: 1,
    alarms: [
      lost("Eingang"), // aelter als 12 Stunden
      lost("Shop", 20),
      { camera: "Halle", at: ALARM_AT },
      { camera: "", at: ALARM_AT, failedAt: ALARM_AT + MAX_AGE_MS, reason: "x" },
      { camera: "Halle", at: ALARM_AT, failedAt: now + MIN, reason: "x" },
      { camera: "Kasse", at: ALARM_AT + 30 * MIN, failedAt: ALARM_AT + 45 * MIN },
      null,
      "kaputt",
    ],
  });
  assert.deepEqual(restoreUndelivered(json, now), [lost("Shop", 20), { camera: "Kasse", at: ALARM_AT + 30 * MIN, failedAt: ALARM_AT + 45 * MIN, reason: "" }]);
});

test("Neustart: unlesbarer Inhalt ergibt eine leere Liste", () => {
  for (const json of ["", "{", "null", "[]", '{"alarms":5}', '{"v":1}']) assert.deepEqual(restoreUndelivered(json, ALARM_AT), [], json);
});

test("Befund: ohne Grund steht nur der Hinweis auf die Zentrale", () => {
  const f = undeliveredFinding([{ ...lost("Eingang"), reason: "" }], ALARM_AT + 16 * MIN);
  assert.equal(f?.detail, "Text und Bild stehen in der Zentrale unter KI.");
});

test("Befund: ein beim Beenden offener Alarm steht nicht in der Zentrale, das sagt der Text", () => {
  for (const reason of [OPEN_AT_EXIT, OPEN_AT_EXIT_SEEN]) {
    const f = undeliveredFinding([{ ...lost("Halle"), reason }], ALARM_AT + 16 * MIN);
    assert.equal(f?.detail, `${reason}. Der Alarm von Halle um 14:05 steht deshalb nicht in der Zentrale unter KI.`);
  }
});

test("Neustart: ein beim Beenden offener Alarm zählt einmal und gilt danach als gesehen", () => {
  const list = [lost("Eingang"), { ...lost("Halle", 5), reason: OPEN_AT_EXIT }];
  const first = markSeenAtExit(list);
  assert.equal(first.fresh, 1);
  assert.deepEqual(first.list, [lost("Eingang"), { ...lost("Halle", 5), reason: OPEN_AT_EXIT_SEEN }]);
  // Zweiter Neustart ohne neues Beenden mit offenem Alarm: keine Zeile mehr.
  const second = markSeenAtExit(first.list);
  assert.equal(second.fresh, 0);
  assert.deepEqual(second.list, first.list);
  assert.deepEqual(list[1].reason, OPEN_AT_EXIT, "die Eingabe bleibt unverändert");
});

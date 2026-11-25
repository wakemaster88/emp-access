import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FACE_GRACE_MIN,
  UNSENT_MAX,
  WATCH_STATE_MAX_AGE_MS,
  announceLine,
  cameraUnreachableTitle,
  diffFindings,
  faceNotReadyDue,
  keepUnsent,
  newWatchState,
  openFindings,
  resolvedLine,
  restoreWatch,
  serializeWatch,
  unnotify,
  watchLogLines,
  watchStep,
  type Finding,
  type WatchState,
} from "./findings.js";

const cam = { key: "cam:5", severity: "warn" as const, title: "Kamera Seilbahn A nicht erreichbar" };
const cloud = { key: "cloud", severity: "alert" as const, title: "Cloud nicht erreichbar" };

test("Warnung erst nach zwei Pruefungen, Entwarnung nur wenn gemeldet", () => {
  const st = newWatchState();
  assert.deepEqual(diffFindings(st, [cam], 0).opened, []);
  assert.deepEqual(diffFindings(st, [cam], 300_000).opened, [cam]);
  assert.deepEqual(diffFindings(st, [cam], 600_000).opened, []);
  assert.deepEqual(openFindings(st), [cam]);
  const d = diffFindings(st, [], 900_000);
  assert.equal(d.resolved.length, 1);
  assert.equal(d.resolved[0].sinceMs, 900_000);
});

test("Einmaliger Aussetzer wird nicht gemeldet und nicht entwarnt", () => {
  const st = newWatchState();
  diffFindings(st, [cam], 0);
  assert.deepEqual(diffFindings(st, [], 300_000), { opened: [], resolved: [] });
});

test("Alarm geht sofort raus", () => {
  const st = newWatchState();
  assert.deepEqual(diffFindings(st, [cloud], 0).opened, [cloud]);
});

test("Ereignis: wird sofort gemeldet, aber nicht entwarnt, wenn es wegfällt", () => {
  const lost = { key: "alarm-undelivered:1", severity: "alert" as const, event: true, title: "Wächter-Alarm nicht zugestellt: Eingang 14:05" };
  const st = newWatchState();
  assert.deepEqual(diffFindings(st, [lost, cloud], 0).opened, [lost, cloud]);
  assert.deepEqual(openFindings(st), [lost, cloud]);
  const d = diffFindings(st, [], 300_000);
  assert.deepEqual(
    d.resolved.map((f) => f.key),
    ["cloud"]
  );
  assert.deepEqual(openFindings(st), []);
});

test("Meldung hat niemanden erreicht: Der Befund kommt bei der nächsten Prüfung erneut", () => {
  const st = newWatchState();
  diffFindings(st, [cam], 0);
  assert.deepEqual(diffFindings(st, [cam, cloud], 300_000).opened, [cam, cloud]);
  assert.equal(unnotify(st, ["cam:5", "cloud", "unbekannt"]), 2);
  assert.deepEqual(openFindings(st), []);
  // Beide sind schon bestaetigt: Sie kommen sofort wieder, mit dem alten Beginn.
  assert.deepEqual(diffFindings(st, [cam, cloud], 600_000).opened, [cam, cloud]);
  assert.deepEqual(diffFindings(st, [cam, cloud], 900_000).opened, []);
  const d = diffFindings(st, [cloud], 1_200_000);
  assert.equal(d.resolved[0].key, "cam:5");
  assert.equal(d.resolved[0].sinceMs, 1_200_000);
});

test("Meldung hat niemanden erreicht und der Befund ist inzwischen weg: keine Entwarnung", () => {
  const st = newWatchState();
  assert.deepEqual(diffFindings(st, [cloud], 0).opened, [cloud]);
  assert.equal(unnotify(st, ["cloud"]), 1);
  assert.equal(unnotify(st, ["cloud"]), 0);
  assert.deepEqual(diffFindings(st, [], 300_000), { opened: [], resolved: [] });
});

/* ------------------------------------------------------------ Eine Prüfung */

const MIN = 60_000;
const ram: Finding = { key: "ram", severity: "warn", title: "Arbeitsspeicher des Hubs bei 93 %" };

test("Prüfung: Warnung nach zwei Prüfungen, Alarm sofort, Entwarnung danach", () => {
  const st = newWatchState();
  assert.deepEqual(watchStep(st, [cam, cloud], 0, false), { announce: [cloud], resolved: [], deferredNow: [] });
  assert.deepEqual(watchStep(st, [cam, cloud], 5 * MIN, false), { announce: [cam], resolved: [], deferredNow: [] });
  assert.deepEqual(watchStep(st, [cam, cloud], 10 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
  const step = watchStep(st, [cam], 15 * MIN, false);
  assert.deepEqual(step, { announce: [], resolved: [{ ...cloud, sinceMs: 15 * MIN }], deferredNow: [] });
});

test("Ruhezeit: Warnungen warten bis zum Morgen, Alarme und Entwarnungen gehen sofort hinaus", () => {
  const st = newWatchState();
  watchStep(st, [cam], 0, false);
  assert.deepEqual(watchStep(st, [cam], 5 * MIN, false).announce, [cam]);
  // 22 Uhr: Ruhezeit beginnt.
  watchStep(st, [cam, ram], 10 * MIN, true);
  const night = watchStep(st, [cam, ram, cloud], 15 * MIN, true);
  assert.deepEqual(night, { announce: [cloud], resolved: [], deferredNow: [ram] });
  assert.deepEqual(st.deferred, [ram]);
  // Die Kamera antwortet nachts wieder: Die Entwarnung kommt sofort.
  assert.deepEqual(watchStep(st, [ram, cloud], 20 * MIN, true), { announce: [], resolved: [{ ...cam, sinceMs: 20 * MIN }], deferredNow: [] });
  // Morgens: die zurueckgestellte Meldung, einmal.
  assert.deepEqual(watchStep(st, [ram, cloud], 9 * 60 * MIN, false), { announce: [ram], resolved: [], deferredNow: [] });
  assert.deepEqual(st.deferred, []);
  assert.deepEqual(watchStep(st, [ram, cloud], 9 * 60 * MIN + 5 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
});

test("Ruhezeit: was nachts kam und wieder ging, wird nicht gemeldet", () => {
  const st = newWatchState();
  watchStep(st, [ram], 0, true);
  assert.deepEqual(watchStep(st, [ram], 5 * MIN, true).deferredNow, [ram]);
  assert.deepEqual(watchStep(st, [], 10 * MIN, true), { announce: [], resolved: [], deferredNow: [] });
  assert.deepEqual(st.deferred, []);
  assert.deepEqual(watchStep(st, [], 9 * 60 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
});

test("Entwarnung hat niemanden erreicht: Sie kommt mit der nächsten Prüfung erneut, genau einmal", () => {
  const st = newWatchState();
  watchStep(st, [cloud], 0, false);
  const step = watchStep(st, [], 10 * MIN, false);
  assert.deepEqual(step.resolved, [{ ...cloud, sinceMs: 10 * MIN }]);
  keepUnsent(st, step.resolved);
  keepUnsent(st, step.resolved);
  assert.equal(st.unsent.length, 1);
  // Auch in der Ruhezeit, mit der Dauer von damals.
  assert.deepEqual(watchStep(st, [], 30 * MIN, true).resolved, [{ ...cloud, sinceMs: 10 * MIN }]);
  assert.deepEqual(st.unsent, []);
  assert.deepEqual(watchStep(st, [], 35 * MIN, false).resolved, []);
});

test("Entwarnung hat niemanden erreicht, der Befund ist wieder gemeldet: Die alte Entwarnung entfällt", () => {
  const st = newWatchState();
  watchStep(st, [cloud], 0, false);
  const gone = watchStep(st, [], 10 * MIN, false);
  // Der Befund kommt zurueck, bevor feststeht, dass die Entwarnung niemanden erreicht hat.
  assert.deepEqual(watchStep(st, [cloud], 15 * MIN, false).announce, [cloud]);
  keepUnsent(st, gone.resolved);
  assert.deepEqual(watchStep(st, [cloud], 25 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
  assert.deepEqual(st.unsent, []);
  // Geht er dann wieder, kommt genau eine Entwarnung.
  keepUnsent(st, gone.resolved);
  assert.deepEqual(watchStep(st, [], 30 * MIN, false).resolved, [{ ...cloud, sinceMs: 15 * MIN }]);
});

test("Entwarnungen, die auf einen neuen Versuch warten, sind begrenzt", () => {
  const st = newWatchState();
  keepUnsent(
    st,
    Array.from({ length: UNSENT_MAX + 5 }, (_, i) => ({ key: `cam:${i}`, severity: "warn" as const, title: `Kamera ${i} nicht erreichbar`, sinceMs: MIN })),
  );
  assert.equal(st.unsent.length, UNSENT_MAX);
  assert.equal(st.unsent[0].key, "cam:5");
});

/* ------------------------------------------------------------ Texte */

test("Meldung: Alarm, Warnung mit Einzelheit, Entwarnung mit Dauer", () => {
  assert.equal(announceLine(cloud), "‼️ Cloud nicht erreichbar");
  assert.equal(announceLine({ ...cam, detail: "10.0.0.5 · Zeitüberschreitung" }), "⚠️ Kamera Seilbahn A nicht erreichbar\n   10.0.0.5 · Zeitüberschreitung");
  assert.equal(resolvedLine({ ...cam, sinceMs: 12 * MIN + 20_000 }), "✅ Wieder in Ordnung: Kamera Seilbahn A nicht erreichbar (nach 12 min)");
  assert.equal(resolvedLine({ ...cam, sinceMs: 5_000 }), "✅ Wieder in Ordnung: Kamera Seilbahn A nicht erreichbar (nach 1 min)");
});

test("Log: je Meldung, Entwarnung und zurückgestellter Meldung eine Zeile mit dem Schlüssel", () => {
  const step = { announce: [cloud, cam], resolved: [{ ...ram, sinceMs: 40 * MIN }], deferredNow: [] };
  assert.deepEqual(watchLogLines(step, true), [
    "Zustands-Wächter: gemeldet [cloud] Cloud nicht erreichbar",
    "Zustands-Wächter: gemeldet [cam:5] Kamera Seilbahn A nicht erreichbar",
    "Zustands-Wächter: Entwarnung [ram] Arbeitsspeicher des Hubs bei 93 % (nach 40 min)",
  ]);
  assert.deepEqual(watchLogLines({ announce: [], resolved: [], deferredNow: [ram] }, true), [
    "Zustands-Wächter: Ruhezeit, Meldung kommt am Morgen [ram] Arbeitsspeicher des Hubs bei 93 %",
  ]);
  assert.deepEqual(watchLogLines({ announce: [cloud], resolved: [], deferredNow: [] }, false), [
    "Zustands-Wächter: gemeldet [cloud] Cloud nicht erreichbar (kein Telegram-Chat gekoppelt, steht im KI-Protokoll)",
  ]);
  assert.deepEqual(watchLogLines({ announce: [], resolved: [], deferredNow: [] }, true), []);
});

test("Titel: „Kamera“ steht nur einmal vor dem Namen", () => {
  assert.equal(cameraUnreachableTitle("Seilbahn A"), "Kamera Seilbahn A nicht erreichbar");
  assert.equal(cameraUnreachableTitle("Kamera Eingang"), "Kamera Eingang nicht erreichbar");
  assert.equal(cameraUnreachableTitle("kamera eingang"), "kamera eingang nicht erreichbar");
  assert.equal(cameraUnreachableTitle("Kamera-Halle"), "Kamera-Halle nicht erreichbar");
  assert.equal(cameraUnreachableTitle("Kamera 3"), "Kamera 3 nicht erreichbar");
  assert.equal(cameraUnreachableTitle("  Shop  "), "Kamera Shop nicht erreichbar");
  // Ein Name, der nur so anfaengt, bekommt das Wort davor.
  assert.equal(cameraUnreachableTitle("Kameramast Nord"), "Kamera Kameramast Nord nicht erreichbar");
  assert.equal(cameraUnreachableTitle(""), "Kamera nicht erreichbar");
});

test("Gesichtserkennung: neu gemeldet erst nach 15 Minuten, ein gemeldeter Befund bleibt bis zur Bereitschaft", () => {
  assert.equal(faceNotReadyDue(false, 6, false), false);
  assert.equal(faceNotReadyDue(false, FACE_GRACE_MIN, false), false);
  assert.equal(faceNotReadyDue(false, FACE_GRACE_MIN + 0.1, false), true);
  // Schon gemeldet (Stand von vor dem Neustart): bleibt, bis der Sidecar bereit ist.
  assert.equal(faceNotReadyDue(false, 6, true), true);
  assert.equal(faceNotReadyDue(true, 6, true), false);
  assert.equal(faceNotReadyDue(true, 60, false), false);
});

/* ------------------------------------------------------------ Stand über Neustarts */

const T0 = Date.UTC(2026, 10, 24, 11, 0);
const HOUR = 60 * MIN;

/** Stand speichern und nach `afterMs` wieder laden, wie bei einem Neustart des Hubs. */
function restart(st: WatchState, savedAt: number, afterMs = 2 * MIN): WatchState {
  const r = restoreWatch(serializeWatch(st, savedAt), savedAt + afterMs, WATCH_STATE_MAX_AGE_MS);
  assert.equal(r.dropped, null);
  assert.equal(r.savedAt, savedAt);
  return r.state;
}

test("Neustart: der Stand kommt unverändert zurück", () => {
  const st = newWatchState();
  watchStep(st, [cam, cloud], T0, false);
  watchStep(st, [{ ...cam, detail: "10.0.0.5" }, cloud, ram], T0 + 5 * MIN, true);
  watchStep(st, [cam, cloud, ram], T0 + 10 * MIN, true);
  keepUnsent(st, [{ key: "disk", severity: "warn", title: "Platte des Hubs bei 91 %", sinceMs: 30 * MIN }]);
  const back = restart(st, T0 + 10 * MIN);
  assert.deepEqual([...back.tracked], [...st.tracked]);
  assert.deepEqual(back.deferred, st.deferred);
  assert.deepEqual(back.unsent, st.unsent);
  assert.deepEqual(openFindings(back), openFindings(st));
});

test("Neustart: derselbe Befund ergibt keine neue Meldung", () => {
  const st = newWatchState();
  watchStep(st, [cam, cloud], T0, false);
  assert.deepEqual(watchStep(st, [cam, cloud], T0 + 5 * MIN, false).announce, [cam]);
  const back = restart(st, T0 + 5 * MIN);
  assert.deepEqual(openFindings(back), [cam, cloud]);
  for (let i = 1; i <= 3; i++) {
    assert.deepEqual(watchStep(back, [cam, cloud], T0 + 10 * MIN + i * 5 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
  }
  assert.deepEqual(diffFindings(restart(st, T0 + 5 * MIN), [cam, cloud], T0 + 15 * MIN), { opened: [], resolved: [] });
});

test("Neustart: verschwindet der Befund danach, kommt die Entwarnung mit der Dauer ab dem ersten Auftreten", () => {
  const st = newWatchState();
  watchStep(st, [cam, cloud], T0, false);
  watchStep(st, [cam, cloud], T0 + 5 * MIN, false);
  const back = restart(st, T0 + 5 * MIN);
  const step = watchStep(back, [cam], T0 + 12 * MIN, false);
  assert.deepEqual(step, { announce: [], resolved: [{ ...cloud, sinceMs: 12 * MIN }], deferredNow: [] });
  assert.deepEqual(diffFindings(restart(st, T0 + 5 * MIN), [], T0 + 12 * MIN).resolved.map((f) => f.key), ["cam:5", "cloud"]);
});

test("Neustart: eine Warnung, die erst einmal gesehen wurde, wird nach der zweiten Prüfung gemeldet", () => {
  const st = newWatchState();
  assert.deepEqual(watchStep(st, [cam], T0, false).announce, []);
  const back = restart(st, T0);
  assert.deepEqual(openFindings(back), []);
  assert.deepEqual(watchStep(back, [cam], T0 + 7 * MIN, false).announce, [cam]);
  // War sie nach dem Neustart weg, gibt es weder Meldung noch Entwarnung.
  assert.deepEqual(watchStep(restart(st, T0), [], T0 + 7 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
});

test("Neustart in der Ruhezeit: die zurückgestellte Meldung kommt am Morgen, einmal", () => {
  const st = newWatchState();
  watchStep(st, [ram], T0, true);
  assert.deepEqual(watchStep(st, [ram], T0 + 5 * MIN, true).deferredNow, [ram]);
  const back = restart(st, T0 + 5 * MIN);
  assert.deepEqual(back.deferred, [ram]);
  assert.deepEqual(watchStep(back, [ram], T0 + 12 * MIN, true), { announce: [], resolved: [], deferredNow: [] });
  assert.deepEqual(watchStep(back, [ram], T0 + 8 * HOUR, false), { announce: [ram], resolved: [], deferredNow: [] });
  assert.deepEqual(watchStep(back, [ram], T0 + 8 * HOUR + 5 * MIN, false).announce, []);
  // War der Befund nach dem Neustart weg, kommt nichts.
  const gone = restart(st, T0 + 5 * MIN);
  assert.deepEqual(watchStep(gone, [], T0 + 12 * MIN, true), { announce: [], resolved: [], deferredNow: [] });
  assert.deepEqual(watchStep(gone, [], T0 + 8 * HOUR, false), { announce: [], resolved: [], deferredNow: [] });
});

test("Neustart: ein Befund, dessen Meldung niemanden erreicht hat, kommt nach dem Neustart erneut", () => {
  const st = newWatchState();
  assert.deepEqual(watchStep(st, [cloud], T0, false).announce, [cloud]);
  unnotify(st, ["cloud"]);
  const back = restart(st, T0 + MIN);
  assert.deepEqual(openFindings(back), []);
  assert.deepEqual(watchStep(back, [cloud], T0 + 7 * MIN, false).announce, [cloud]);
});

test("Neustart: eine Entwarnung, die niemanden erreicht hat, kommt nach dem Neustart erneut", () => {
  const st = newWatchState();
  watchStep(st, [cloud], T0, false);
  keepUnsent(st, watchStep(st, [], T0 + 10 * MIN, false).resolved);
  const back = restart(st, T0 + 25 * MIN);
  assert.deepEqual(watchStep(back, [], T0 + 32 * MIN, false).resolved, [{ ...cloud, sinceMs: 10 * MIN }]);
});

test("Neustart: ein Ereignis bleibt gemeldet und bekommt keine Entwarnung", () => {
  const lost = { key: "alarm-undelivered:1", severity: "alert" as const, event: true, title: "Wächter-Alarm nicht zugestellt: Eingang 14:05" };
  const st = newWatchState();
  watchStep(st, [lost], T0, false);
  const back = restart(st, T0);
  assert.deepEqual(watchStep(back, [lost], T0 + 7 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
  assert.deepEqual(watchStep(back, [], T0 + 12 * MIN, false), { announce: [], resolved: [], deferredNow: [] });
});

test("Neustart: ein leerer Stand, der älter als 24 Stunden ist, gilt still (es ging nichts verloren)", () => {
  // Ein Befund kam und ging; danach wird der leere Stand nie neu geschrieben.
  const st = newWatchState();
  watchStep(st, [cloud], T0, false);
  watchStep(st, [cloud], T0 + 6 * MIN, false);
  watchStep(st, [], T0 + 12 * MIN, false);
  watchStep(st, [], T0 + 18 * MIN, false);
  assert.deepEqual(openFindings(st), []);
  const json = serializeWatch(st, T0 + 18 * MIN);
  const r = restoreWatch(json, T0 + 18 * MIN + 25 * HOUR, WATCH_STATE_MAX_AGE_MS);
  assert.equal(r.dropped, null);
  assert.deepEqual(r.state, newWatchState());
  // Eine Entwarnung, die noch zu senden ist, zaehlt als Inhalt: Dann wird verworfen.
  const withUnsent = JSON.stringify({ ...JSON.parse(json), unsent: [{ ...cloud, sinceMs: 12 * MIN }] });
  assert.equal(restoreWatch(withUnsent, T0 + 18 * MIN + 25 * HOUR, WATCH_STATE_MAX_AGE_MS).dropped, "veraltet");
});

test("Neustart: ein Stand, der älter als 24 Stunden ist, wird verworfen", () => {
  const st = newWatchState();
  watchStep(st, [cloud], T0, false);
  const json = serializeWatch(st, T0);
  const edge = restoreWatch(json, T0 + WATCH_STATE_MAX_AGE_MS, WATCH_STATE_MAX_AGE_MS);
  assert.equal(edge.dropped, null);
  assert.deepEqual(openFindings(edge.state), [cloud]);
  const old = restoreWatch(json, T0 + WATCH_STATE_MAX_AGE_MS + 1, WATCH_STATE_MAX_AGE_MS);
  assert.equal(old.dropped, "veraltet");
  assert.equal(old.savedAt, null);
  assert.deepEqual(old.state, newWatchState());
  // Dann beginnt der Waechter wie nach dem ersten Start: Der Befund wird gemeldet.
  assert.deepEqual(watchStep(old.state, [cloud], T0 + WATCH_STATE_MAX_AGE_MS + 6 * MIN, false).announce, [cloud]);
  assert.equal(WATCH_STATE_MAX_AGE_MS, 24 * HOUR);
});

test("Neustart: ein unlesbarer Stand wird verworfen", () => {
  const bad = ["", "{", "null", "[]", "5", '"x"', "{}", '{"v":1}', '{"v":1,"savedAt":"gestern","tracked":[]}', '{"v":1,"savedAt":5}', '{"v":2,"savedAt":5,"tracked":[]}'];
  for (const json of bad) {
    const r = restoreWatch(json, T0, WATCH_STATE_MAX_AGE_MS);
    assert.equal(r.dropped, "unlesbar", json);
    assert.deepEqual(r.state, newWatchState(), json);
  }
});

test("Neustart: unvollständige Einträge werden übersprungen, kein Beginn liegt in der Zukunft", () => {
  const json = JSON.stringify({
    v: 1,
    savedAt: T0,
    tracked: [
      { finding: cam, seen: 4, since: T0 - HOUR, notified: true },
      { finding: { key: "cloud", severity: "alert" }, seen: 1, since: T0, notified: true },
      { finding: { key: "x", severity: "laut", title: "X" }, seen: 1, since: T0, notified: true },
      { finding: { ...ram, detail: 5, event: "ja" }, seen: "oft", since: T0 + 3 * HOUR, notified: "ja" },
      null,
      "kaputt",
    ],
    deferred: [cam, cam, ram, cloud, null],
    unsent: [{ ...cloud, sinceMs: 5 * MIN }, { ...cloud, sinceMs: 6 * MIN }, { ...ram }, { key: "y", sinceMs: MIN }, 7],
  });
  const r = restoreWatch(json, T0 + MIN, WATCH_STATE_MAX_AGE_MS);
  assert.equal(r.dropped, null);
  assert.deepEqual(
    [...r.state.tracked.values()],
    [
      { finding: cam, seen: 4, since: T0 - HOUR, notified: true },
      { finding: ram, seen: 1, since: T0 + MIN, notified: false },
    ],
  );
  // Zurueckgestellt ist nur, was als gemeldet gefuehrt wird; je Befund eine Meldung.
  assert.deepEqual(r.state.deferred, [cam]);
  assert.deepEqual(r.state.unsent, [{ ...cloud, sinceMs: 5 * MIN }]);
});

test("Neustart: ohne Listen für zurückgestellte Meldungen und Entwarnungen bleiben diese leer", () => {
  const r = restoreWatch(JSON.stringify({ v: 1, savedAt: T0, tracked: [{ finding: cam, seen: 2, since: T0, notified: true }] }), T0, WATCH_STATE_MAX_AGE_MS);
  assert.equal(r.dropped, null);
  assert.deepEqual(openFindings(r.state), [cam]);
  assert.deepEqual(r.state.deferred, []);
  assert.deepEqual(r.state.unsent, []);
});

import { inQuietHours } from "./quiet.js";

test("Ruhezeit über Mitternacht", () => {
  assert.equal(inQuietHours("22-7", 23), true);
  assert.equal(inQuietHours("22-7", 3), true);
  assert.equal(inQuietHours("22-7", 7), false);
  assert.equal(inQuietHours("22-7", 12), false);
  assert.equal(inQuietHours("0", 3), false);
  assert.equal(inQuietHours("1-5", 2), true);
});

import { stripThinkingForTest } from "./think.js";

test("Denkblöcke werden entfernt", () => {
  assert.equal(stripThinkingForTest("<think>hm</think>\nAlles ruhig."), "Alles ruhig.");
  assert.equal(stripThinkingForTest("Okay, also …</think>Antwort"), "Antwort");
  assert.equal(stripThinkingForTest("Nur Text"), "Nur Text");
});

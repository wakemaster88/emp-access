import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHITELIST_FRESH_MS,
  WHITELIST_MAX_AGE_H_DEFAULT,
  agoText,
  cacheOkAt,
  cacheWriteDue,
  mergeTriggeredAt,
  staleAlertSource,
  staleAlertStep,
  whitelistMaxAgeMs,
  whitelistState,
  whitelistWait,
} from "./whitelist-rules.js";

const H = 3_600_000;
const NOW = Date.parse("2026-11-25T18:00:00Z");
const WEEK = 168 * H;

test("HUB_WHITELIST_MAX_AGE_H: Standard 168 h, 0 = unbegrenzt, Ungültiges ergibt den Standard", () => {
  assert.equal(WHITELIST_MAX_AGE_H_DEFAULT, 168);
  assert.equal(whitelistMaxAgeMs(undefined), WEEK);
  assert.equal(whitelistMaxAgeMs(""), WEEK);
  assert.equal(whitelistMaxAgeMs("  "), WEEK);
  assert.equal(whitelistMaxAgeMs("abc"), WEEK);
  assert.equal(whitelistMaxAgeMs("-5"), WEEK);
  assert.equal(whitelistMaxAgeMs("0"), 0);
  assert.equal(whitelistMaxAgeMs("24"), 24 * H);
  assert.equal(whitelistMaxAgeMs(" 72 "), 72 * H);
  assert.equal(whitelistMaxAgeMs("0.5"), 30 * 60_000);
});

test("Fahrzeugliste: frisch, alt aber nutzbar, zu alt", () => {
  // Eben abgerufen.
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW - 4 * 60_000, maxAgeMs: WEEK }), "fresh");
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW - WHITELIST_FRESH_MS, maxAgeMs: WEEK }), "fresh");
  // Cloud seit 6 Stunden nicht erreichbar: alt, schaltet aber weiter.
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW - 6 * H, maxAgeMs: WEEK }), "old");
  // Genau 7 Tage: noch nutzbar; danach zu alt.
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW - WEEK, maxAgeMs: WEEK }), "old");
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW - WEEK - 1, maxAgeMs: WEEK }), "stale");
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW - 25 * H, maxAgeMs: 24 * H }), "stale");
});

test("Fahrzeugliste: ohne Höchstalter nie zu alt, ohne bekannten Abruf mit Höchstalter zu alt", () => {
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW - 400 * 24 * H, maxAgeMs: 0 }), "old");
  assert.equal(whitelistState({ now: NOW, lastOkAt: null, maxAgeMs: 0 }), "old");
  assert.equal(whitelistState({ now: NOW, lastOkAt: null, maxAgeMs: WEEK }), "stale");
  // Uhr verstellt: Zeitpunkt in der Zukunft zählt als frisch.
  assert.equal(whitelistState({ now: NOW, lastOkAt: NOW + H, maxAgeMs: WEEK }), "fresh");
});

const WAIT = { ttlMs: 300_000, retryMs: 60_000, maxWaitMs: 1_500 };

test("Abgleich je Bild: ohne Liste wird wie bisher bis zum Ende des Abrufs gewartet", () => {
  assert.deepEqual(whitelistWait({ ...WAIT, now: NOW, hasList: false, loadedAt: 0, failedAt: 0 }), {
    fetch: true,
    waitMs: Number.POSITIVE_INFINITY,
  });
  // Auch direkt nach einem Fehler: ohne Liste gibt es nichts, womit der Burst weiterarbeiten könnte.
  assert.equal(whitelistWait({ ...WAIT, now: NOW, hasList: false, loadedAt: 0, failedAt: NOW - 1_000 }).fetch, true);
});

test("Abgleich je Bild: frische Liste ohne Abruf, alte Liste mit gemeinsamem Abruf und höchstens 1,5 s Warten", () => {
  assert.deepEqual(whitelistWait({ ...WAIT, now: NOW, hasList: true, loadedAt: NOW - 60_000, failedAt: 0 }), {
    fetch: false,
    waitMs: 0,
  });
  assert.deepEqual(whitelistWait({ ...WAIT, now: NOW, hasList: true, loadedAt: NOW - 301_000, failedAt: 0 }), {
    fetch: true,
    waitMs: 1_500,
  });
});

test("Abgleich je Bild: in der Minute nach einem gescheiterten Abruf kein Warten und kein neuer Abruf", () => {
  const old = { ...WAIT, now: NOW, hasList: true, loadedAt: NOW - 2 * H };
  assert.deepEqual(whitelistWait({ ...old, failedAt: NOW - 10_000 }), { fetch: false, waitMs: 0 });
  assert.deepEqual(whitelistWait({ ...old, failedAt: NOW - 59_999 }), { fetch: false, waitMs: 0 });
  // Nach 60 s wieder ein Versuch, auf den höchstens 1,5 s gewartet wird.
  assert.deepEqual(whitelistWait({ ...old, failedAt: NOW - 60_000 }), { fetch: true, waitMs: 1_500 });
});

test("Abgleich je Bild: läuft schon ein Abruf, wird nur bis 1,5 s nach seinem Beginn gewartet", () => {
  const old = { ...WAIT, hasList: true, loadedAt: NOW - H, failedAt: 0 };
  assert.deepEqual(whitelistWait({ ...old, now: NOW + 500, fetchStartedAt: NOW }), { fetch: true, waitMs: 1_000 });
  assert.deepEqual(whitelistWait({ ...old, now: NOW + 1_500, fetchStartedAt: NOW }), { fetch: true, waitMs: 0 });
  assert.deepEqual(whitelistWait({ ...old, now: NOW + 7_000, fetchStartedAt: NOW }), { fetch: true, waitMs: 0 });
  // Uhr verstellt: nie länger als 1,5 s.
  assert.deepEqual(whitelistWait({ ...old, now: NOW, fetchStartedAt: NOW + 60_000 }), { fetch: true, waitMs: 1_500 });
});

test("Abgleich je Bild: 20 Bilder bei hängender Cloud warten zusammen höchstens 1,5 s, ein Abruf je Minute", () => {
  // Bilder alle 0,7 s über zwei Minuten; jeder Abruf hängt bis zum Zeitlimit von 8 s.
  let failedAt = 0;
  let fetchStartedAt: number | null = null;
  let fetches = 0;
  let waitEnd = 0;
  for (let i = 0; i < 180; i++) {
    const now = NOW + i * 700;
    if (fetchStartedAt != null && now >= fetchStartedAt + 8_000) {
      failedAt = fetchStartedAt + 8_000;
      fetchStartedAt = null;
    }
    const plan = whitelistWait({ ...WAIT, now, hasList: true, loadedAt: NOW - H, failedAt, fetchStartedAt });
    if (!plan.fetch) continue;
    if (fetchStartedAt == null) {
      fetchStartedAt = now;
      fetches++;
    }
    assert.ok(
      plan.waitMs === 0 || now + plan.waitMs <= fetchStartedAt + 1_500,
      `Bild ${i + 1} wartet bis ${now + plan.waitMs - fetchStartedAt} ms nach Abrufbeginn`
    );
    if (i < 20 && plan.waitMs > 0) waitEnd = Math.max(waitEnd, now + plan.waitMs);
  }
  // Die ersten 20 Bilder (ein Burst): Warten endet spätestens 1,5 s nach dem ersten Bild.
  assert.equal(waitEnd - NOW, 1_500);
  // In 126 s zwei Abrufe: bei 0 s und beim ersten Bild nach 68 s (8 s hängen + 60 s Pause).
  assert.equal(fetches, 2);
});

test("Nachladen: je Fahrzeug bleibt der neuere Schaltzeitpunkt", () => {
  const local = [
    { id: 1, lastTriggeredAt: NOW - 30_000 }, // eben lokal geöffnet, Upload noch unterwegs
    { id: 2, lastTriggeredAt: NOW - 3 * H },
    { id: 3, lastTriggeredAt: null },
  ];
  const cloud = [
    { id: 1, name: "a", lastTriggeredAt: NOW - 2 * H },
    { id: 2, name: "b", lastTriggeredAt: NOW - 60_000 }, // Cloud weiß von einer neueren Öffnung
    { id: 3, name: "c", lastTriggeredAt: NOW - 5 * H },
    { id: 4, name: "d", lastTriggeredAt: null }, // neu in der Liste
  ];
  const merged = mergeTriggeredAt(local, cloud, NOW);
  assert.deepEqual(
    merged.map((v) => [v.id, v.lastTriggeredAt]),
    [
      [1, NOW - 30_000],
      [2, NOW - 60_000],
      [3, NOW - 5 * H],
      [4, null],
    ]
  );
  // Die übrigen Felder kommen aus der Cloud.
  assert.equal(merged[0].name, "a");
  // Lokal bekannt, in der Cloud ohne Zeitpunkt: der lokale bleibt.
  assert.equal(mergeTriggeredAt([{ id: 4, lastTriggeredAt: NOW - 1_000 }], [{ id: 4, lastTriggeredAt: null }], NOW)[0].lastTriggeredAt, NOW - 1_000);
});

test("Nachladen: ein lokaler Schaltzeitpunkt weit in der Zukunft (Uhr ging vor) zählt nicht", () => {
  const cloud = [{ id: 1, lastTriggeredAt: NOW - 10 * 60_000 }, { id: 2, lastTriggeredAt: null }];
  // Uhr ging 6 h vor, inzwischen gestellt: Es gilt der Wert der Cloud.
  const merged = mergeTriggeredAt(
    [{ id: 1, lastTriggeredAt: NOW + 6 * H }, { id: 2, lastTriggeredAt: NOW + 6 * H }],
    cloud,
    NOW
  );
  assert.deepEqual(merged.map((v) => v.lastTriggeredAt), [NOW - 10 * 60_000, null]);
  // Wenige Sekunden oder Minuten voraus (Uhr leicht nachgestellt): bleibt als neuerer Wert.
  assert.equal(mergeTriggeredAt([{ id: 1, lastTriggeredAt: NOW + 2_000 }], cloud, NOW)[0].lastTriggeredAt, NOW + 2_000);
  assert.equal(mergeTriggeredAt([{ id: 1, lastTriggeredAt: NOW + 5 * 60_000 }], cloud, NOW)[0].lastTriggeredAt, NOW + 5 * 60_000);
  assert.equal(mergeTriggeredAt([{ id: 1, lastTriggeredAt: NOW + 5 * 60_000 + 1 }], cloud, NOW)[0].lastTriggeredAt, NOW - 10 * 60_000);
  // Zweites Nachladen danach: Der Wert der Cloud bleibt, nichts wächst nach.
  assert.equal(mergeTriggeredAt(merged, cloud, NOW + 5 * 60_000)[0].lastTriggeredAt, NOW - 10 * 60_000);
});

test("Cache-Datei: Abruf-Zeitpunkt aus fetchedAt, bei alten Dateien die Änderungszeit", () => {
  assert.equal(cacheOkAt({ fetchedAt: NOW - H, mtimeMs: NOW - 60_000 }), NOW - H);
  assert.equal(cacheOkAt({ fetchedAt: undefined, mtimeMs: NOW - 2 * H }), NOW - 2 * H);
  assert.equal(cacheOkAt({ fetchedAt: "gestern", mtimeMs: NOW - 2 * H }), NOW - 2 * H);
  assert.equal(cacheOkAt({ fetchedAt: 0, mtimeMs: NOW - 2 * H }), NOW - 2 * H);
  assert.equal(cacheOkAt({ fetchedAt: undefined, mtimeMs: null }), null);
});

test("Cache-Datei: geschrieben bei geänderter Liste oder wenn der gespeicherte Abruf eine Stunde alt ist", () => {
  const base = { now: NOW, stampMs: H };
  assert.equal(cacheWriteDue({ ...base, changed: true, persistedOkAt: NOW - 60_000 }), true);
  assert.equal(cacheWriteDue({ ...base, changed: false, persistedOkAt: null }), true);
  assert.equal(cacheWriteDue({ ...base, changed: false, persistedOkAt: NOW - 5 * 60_000 }), false);
  assert.equal(cacheWriteDue({ ...base, changed: false, persistedOkAt: NOW - H }), true);
});

test("Alter als Text für „seit …“ und „Stand vor …“", () => {
  assert.equal(agoText(20_000), "weniger als einer Minute");
  assert.equal(agoText(60_000), "1 Minute");
  assert.equal(agoText(45 * 60_000), "45 Minuten");
  assert.equal(agoText(119 * 60_000), "119 Minuten");
  assert.equal(agoText(5 * H), "5 Stunden");
  assert.equal(agoText(47 * H), "47 Stunden");
  assert.equal(agoText(WEEK + H), "7 Tagen");
  assert.equal(agoText(-5), "weniger als einer Minute");
});

test("Meldung „Fahrzeugliste zu alt“ an die Cloud: einmal beim Eintritt, Entwarnung einmal", () => {
  const base = { now: NOW, failedAt: 0, retryMs: 30 * 60_000 };
  // Zu alt, Cloud weiß nichts (auch nach einem Neustart): melden.
  assert.equal(staleAlertStep({ ...base, stale: true, reported: false }), "open");
  assert.equal(staleAlertStep({ ...base, stale: true, reported: null }), "open");
  // Gemeldet: nicht noch einmal.
  assert.equal(staleAlertStep({ ...base, stale: true, reported: true }), null);
  // Wieder frisch: Entwarnung, auch wenn nach einem Neustart unbekannt ist, ob etwas offen war.
  assert.equal(staleAlertStep({ ...base, stale: false, reported: true }), "resolve");
  assert.equal(staleAlertStep({ ...base, stale: false, reported: null }), "resolve");
  // Frisch und nichts offen: nichts senden.
  assert.equal(staleAlertStep({ ...base, stale: false, reported: false }), null);
});

test("Meldung „Fahrzeugliste zu alt“: nach einem gescheiterten Versuch erst 30 min später wieder", () => {
  const retryMs = 30 * 60_000;
  assert.equal(staleAlertStep({ stale: true, reported: false, now: NOW, failedAt: NOW - 29 * 60_000, retryMs }), null);
  assert.equal(staleAlertStep({ stale: true, reported: false, now: NOW, failedAt: NOW - 30 * 60_000, retryMs }), "open");
  assert.equal(staleAlertStep({ stale: false, reported: true, now: NOW, failedAt: NOW - 60_000, retryMs }), null);
  assert.equal(staleAlertStep({ stale: false, reported: true, now: NOW, failedAt: NOW - 31 * 60_000, retryMs }), "resolve");
});

test("Meldung Fahrzeugliste zu alt: Quelle je Hub, gültig für die Cloud", () => {
  const re = /^[a-z][a-z0-9-]{0,31}$/;
  assert.equal(staleAlertSource("imac-technikraum"), "fahrzeugliste-imac-technikraum");
  assert.equal(staleAlertSource("Hub Büro 2"), "fahrzeugliste-hub-buero-2");
  assert.equal(staleAlertSource("  "), "fahrzeugliste");
  assert.equal(staleAlertSource("---"), "fahrzeugliste");
  const long = staleAlertSource("ein sehr langer Name für den Test-Hub am See");
  assert.ok(re.test(long), long);
  assert.ok(!long.endsWith("-"), long);
  for (const name of ["imac-technikraum", "Hub Büro 2", "", "ÄÖÜ ß", "x".repeat(80)]) assert.ok(re.test(staleAlertSource(name)), name);
  assert.notEqual(staleAlertSource("hub-a"), staleAlertSource("hub-b"));
});

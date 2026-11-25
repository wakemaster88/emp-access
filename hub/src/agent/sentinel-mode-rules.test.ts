import { test } from "node:test";
import assert from "node:assert/strict";
import { modeAlways, readSentinelMode, sentinelClosed, sentinelModeLines, type SentinelMode } from "./sentinel-mode-rules.js";
import { planTick, newQueue, shouldInspect, type SentinelContext } from "./sentinel-rules.js";

const NIGHT = "22-6";
const ev = { kind: "camera", title: "PERSON erkannt", where: "Eingang" };
const base: SentinelContext = {
  closed: null,
  hour: 12,
  nightWindow: NIGHT,
  always: false,
  lastInspectAt: undefined,
  now: 1_000_000,
  cooldownMs: 180_000,
  inspectionsLastHour: 0,
  maxPerHour: 30,
};

/** Bewertet der Wächter ein PERSON-Ereignis dieser Kamera zur Stunde `hour`? */
function inspects(mode: SentinelMode, roomClosed: boolean | null, hour: number, always = false): boolean {
  const closed = sentinelClosed(mode, roomClosed, hour);
  if (closed === "aus") return false;
  return shouldInspect(ev, { ...base, closed, hour, always: modeAlways(mode, always) });
}

test("readSentinelMode: NIGHT, OFF, sonst der Standard", () => {
  assert.equal(readSentinelMode("NIGHT"), "nachts");
  assert.equal(readSentinelMode("OFF"), "aus");
  assert.equal(readSentinelMode(" night "), "nachts");
  // Ältere Cloud ohne das Feld, leerer oder unbekannter Wert: wie der Raum.
  for (const v of [undefined, null, "", "TAG", "AN", 1, true, {}]) assert.equal(readSentinelMode(v), "raum", JSON.stringify(v));
});

test("Nur nachts: Stunde 14 nein, Stunde 23 ja, auch wenn der Raum den ganzen Tag geschlossen ist", () => {
  assert.equal(inspects("nachts", true, 14), false);
  assert.equal(inspects("nachts", true, 23), true);
  // Auch bei offenem Raum oder ohne Betriebszeit entscheidet allein das Nachtfenster.
  assert.equal(inspects("nachts", false, 23), true);
  assert.equal(inspects("nachts", null, 3), true);
  assert.equal(inspects("nachts", null, 6), false);
  assert.equal(inspects("nachts", false, 14), false);
});

test("Nur nachts: Stunde nicht lesbar heißt bewacht", () => {
  assert.equal(sentinelClosed("nachts", false, NaN), true);
  assert.equal(inspects("nachts", false, NaN), true);
});

test("Wie der Raum: unverändert", () => {
  assert.equal(sentinelClosed("raum", true, 14), true);
  assert.equal(sentinelClosed("raum", false, 23), false);
  assert.equal(sentinelClosed("raum", null, 23), null);
  assert.equal(inspects("raum", true, 14), true);
  assert.equal(inspects("raum", false, 23), false);
  assert.equal(inspects("raum", null, 14), false);
  assert.equal(inspects("raum", null, 23), true);
});

test("Unbekannter Wert zählt als Standard", () => {
  const mode = readSentinelMode("ABENDS");
  assert.equal(inspects(mode, true, 14), true);
  assert.equal(inspects(mode, null, 14), false);
  assert.equal(inspects(mode, null, 23), true);
});

test("Aus: nie bewertet, auch nachts und mit HUB_AGENT_SENTINEL=always", () => {
  assert.equal(sentinelClosed("aus", true, 23), "aus");
  assert.equal(inspects("aus", true, 23), false);
  assert.equal(inspects("aus", true, 14, true), false);
});

test("Nur nachts: auch mit HUB_AGENT_SENTINEL=always allein im Nachtfenster", () => {
  assert.equal(inspects("nachts", true, 14, true), false);
  assert.equal(inspects("nachts", false, 14, true), false);
  assert.equal(inspects("nachts", false, 23, true), true);
  assert.equal(inspects("nachts", false, 5, true), true);
  assert.equal(inspects("nachts", false, 6, true), false);
  // Stunde nicht lesbar: Die Nacht lässt sich nicht ausschließen.
  assert.equal(inspects("nachts", false, NaN, true), true);
  // „wie der Raum“ bewertet mit always rund um die Uhr, auch bei offenem Raum.
  assert.equal(inspects("raum", false, 14, true), true);
  assert.deepEqual(
    (["raum", "nachts", "aus"] as const).map((m) => [modeAlways(m, true), modeAlways(m, false)]),
    [
      [true, false],
      [false, false],
      [false, false],
    ]
  );
});

test("Takt: ein Ereignis einer Kamera mit „nur nachts“ ist am Tag kein Auslöser, auch mit always", () => {
  for (const always of [false, true]) {
    const q = newQueue(0);
    const input = (hour: number) => ({
      now: 10_000_000 + hour,
      hour,
      nightWindow: NIGHT,
      maxPerHour: 30,
      maxBusy: 2,
      events: [{ ev, camId: 9, where: "Eingang", closed: sentinelClosed("nachts", true, hour) as boolean | null, always: modeAlways("nachts", always) }],
    });
    const day = planTick(q, input(14));
    assert.equal(day.triggers, 0, `always=${always}`);
    assert.equal(day.start.length, 0);
    const night = planTick(q, input(23));
    assert.equal(night.triggers, 1, `always=${always}`);
    assert.equal(night.start.length, 1);
  }
});

test("sentinelModeLines: beim Start nur abweichende Kameras, danach jede Änderung einmal", () => {
  const cams = (eingang: SentinelMode, halle: SentinelMode = "raum") => [
    { id: 9, name: "Eingang", mode: eingang },
    { id: 3, name: "Halle 2", mode: halle },
  ];
  const start = sentinelModeLines(null, cams("nachts", "aus"), NIGHT);
  assert.deepEqual(start.lines, [
    "Wächter: Kamera Eingang: Wächter nur nachts (22-6 Uhr)",
    "Wächter: Kamera Halle 2: Wächter aus, die Kamera wird nicht bewertet",
  ]);
  // Gleicher Stand: keine Zeile.
  const same = sentinelModeLines(start.next, cams("nachts", "aus"), NIGHT);
  assert.deepEqual(same.lines, []);
  // Änderung, auch zurück zum Standard.
  const changed = sentinelModeLines(same.next, cams("raum", "aus"), NIGHT);
  assert.deepEqual(changed.lines, ["Wächter: Kamera Eingang: jetzt Wächter wie der Raum (vorher nur nachts)"]);
  // Nur Standard beim Start: keine Zeile.
  assert.deepEqual(sentinelModeLines(null, cams("raum"), NIGHT).lines, []);
});

test("sentinelModeLines: Kameras, die erst nach dem Start geladen werden, zählen wie beim Start", () => {
  const empty = sentinelModeLines(null, [], NIGHT);
  assert.deepEqual(empty.lines, []);
  const loaded = sentinelModeLines(empty.next, [{ id: 9, name: "Eingang", mode: "nachts" }, { id: 3, name: "Halle 2", mode: "raum" }], NIGHT);
  assert.deepEqual(loaded.lines, ["Wächter: Kamera Eingang: Wächter nur nachts (22-6 Uhr)"]);
  // Eine entfernte Kamera schreibt nichts.
  assert.deepEqual(sentinelModeLines(loaded.next, [{ id: 3, name: "Halle 2", mode: "raum" }], NIGHT).lines, []);
});

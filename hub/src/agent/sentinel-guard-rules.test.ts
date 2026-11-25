import { test } from "node:test";
import assert from "node:assert/strict";
import {
  berlinClock,
  complement,
  guardChangeLines,
  guardState,
  guardTodayLine,
  nextYmd,
  nightSpans,
  spanMinutes,
  spansText,
  type GuardCamera,
  type TodayCamera,
  type TodayInput,
} from "./sentinel-guard-rules.js";

const rooms = (names: string[], closed: boolean | null, stale = false) => ({ closed, rooms: names, stale });
const ctx = { always: false, hour: 23, nightWindow: "22-6" };
const cam = (id: number, over: Partial<GuardCamera>): GuardCamera => ({ id, name: `Kamera ${id}`, mode: "raum", rooms: rooms([], null), ...over });

test("guardState: Raum, Nachtfenster, „nur nachts“, aus und rund um die Uhr", () => {
  assert.deepEqual(guardState(cam(1, { rooms: rooms(["Shop"], true) }), { ...ctx, hour: 14 }), {
    id: 1,
    name: "Kamera 1",
    watched: true,
    why: "Raum Shop geschlossen",
  });
  assert.equal(guardState(cam(1, { rooms: rooms(["Shop"], false) }), ctx).why, "Raum Shop offen");
  assert.equal(guardState(cam(1, { rooms: rooms(["Shop"], false) }), ctx).watched, false, "offener Raum auch nachts nicht");
  assert.equal(guardState(cam(1, { rooms: rooms(["Shop", "Gastro"], false) }), ctx).why, "einer der Räume Shop, Gastro offen");
  assert.deepEqual(guardState(cam(2, {}), ctx), { id: 2, name: "Kamera 2", watched: true, why: "ohne Betriebszeit, Nachtfenster 22-6 Uhr" });
  assert.deepEqual(guardState(cam(2, {}), { ...ctx, hour: 14 }).why, "ohne Betriebszeit, außerhalb des Nachtfensters 22-6 Uhr");
  assert.equal(guardState(cam(3, { mode: "nachts", rooms: rooms(["Shop"], false) }), ctx).watched, true);
  assert.equal(guardState(cam(3, { mode: "nachts", rooms: rooms(["Shop"], true) }), { ...ctx, hour: 14 }).watched, false);
  assert.deepEqual(guardState(cam(5, { mode: "aus", rooms: rooms(["Shop"], true) }), { ...ctx, always: true }), {
    id: 5,
    name: "Kamera 5",
    watched: false,
    why: "Wächter aus",
  });
  assert.deepEqual(guardState(cam(1, { rooms: rooms(["Shop"], false) }), { ...ctx, always: true, hour: 14 }).why, "rund um die Uhr");
  // „nur nachts“ bleibt auch mit always beim Nachtfenster.
  assert.deepEqual(guardState(cam(3, { mode: "nachts", rooms: rooms(["Shop"], true) }), { ...ctx, always: true, hour: 14 }), {
    id: 3,
    name: "Kamera 3",
    watched: false,
    why: guardState(cam(3, { mode: "nachts", rooms: rooms(["Shop"], true) }), { ...ctx, hour: 14 }).why,
  });
  assert.equal(guardState(cam(3, { mode: "nachts", rooms: rooms(["Shop"], false) }), { ...ctx, always: true }).watched, true);
});

test("guardState: veraltete Raumdaten stehen im Grund", () => {
  assert.equal(guardState(cam(1, { rooms: rooms(["Shop"], true, true) }), ctx).why, "Raum Shop geschlossen (Raumdaten veraltet)");
  const day = guardState(cam(1, { rooms: rooms(["Shop"], null, true) }), { ...ctx, hour: 14 });
  assert.deepEqual([day.watched, day.why], [false, "Raumdaten veraltet, außerhalb des Nachtfensters 22-6 Uhr"]);
  assert.equal(guardState(cam(1, { rooms: rooms(["Shop"], null, true) }), ctx).watched, true);
});

test("guardState: Stunde nicht lesbar wie im Takt", () => {
  const nan = { ...ctx, hour: Number.NaN };
  assert.deepEqual([guardState(cam(3, { mode: "nachts" }), nan).watched, guardState(cam(3, { mode: "nachts" }), nan).why], [true, "nur nachts, Uhrzeit nicht lesbar"]);
  assert.equal(guardState(cam(2, {}), nan).watched, false);
  assert.equal(guardState(cam(1, { rooms: rooms(["Shop"], true) }), nan).watched, true);
});

const st = (id: number, name: string, watched: boolean, why: string) => ({ id, name, watched, why });

test("guardChangeLines: beim Start eine Übersicht, danach nur Wechsel, nach Grund zusammengefasst", () => {
  const start = guardChangeLines(null, [
    st(1, "Kasse", true, "Raum Shop geschlossen"),
    st(2, "Gastro", true, "Raum Shop geschlossen"),
    st(3, "Lager", true, "ohne Betriebszeit, Nachtfenster 22-6 Uhr"),
    st(5, "Büro", false, "Wächter aus"),
  ]);
  assert.deepEqual(start.lines, [
    "Wächter: beim Start bewacht: Kasse, Gastro (Raum Shop geschlossen); Lager (ohne Betriebszeit, Nachtfenster 22-6 Uhr)",
    "Wächter: beim Start nicht bewacht: Büro (Wächter aus)",
  ]);
  const same = guardChangeLines(start.next, [
    st(1, "Kasse", true, "Raum Shop geschlossen (Raumdaten veraltet)"),
    st(2, "Gastro", true, "Raum Shop geschlossen"),
    st(3, "Lager", true, "ohne Betriebszeit, Nachtfenster 22-6 Uhr"),
    st(5, "Büro", false, "Wächter aus"),
  ]);
  assert.deepEqual(same.lines, [], "nur der Grund ändert sich: kein Wechsel");
  const morning = guardChangeLines(same.next, [
    st(1, "Kasse", false, "Raum Shop offen"),
    st(2, "Gastro", false, "Raum Shop offen"),
    st(3, "Lager", false, "ohne Betriebszeit, außerhalb des Nachtfensters 22-6 Uhr"),
    st(5, "Büro", false, "Wächter aus"),
    st(9, "Eingang", true, "Raum Strandbad geschlossen"),
  ]);
  assert.deepEqual(morning.lines, [
    "Wächter: Bewachung an: Eingang (Raum Strandbad geschlossen)",
    "Wächter: Bewachung aus: Kasse, Gastro (Raum Shop offen); Lager (ohne Betriebszeit, außerhalb des Nachtfensters 22-6 Uhr)",
  ]);
  assert.deepEqual(guardChangeLines(morning.next, [st(9, "Eingang", true, "Raum Strandbad geschlossen")]).lines, [], "entfernte Kamera schreibt nichts");
  assert.deepEqual(guardChangeLines(null, []).lines, []);
});

test("berlinClock, nextYmd und spanMinutes: Ortszeit, auch über die Zeitumstellung", () => {
  assert.deepEqual(berlinClock(Date.parse("2026-11-25T09:00:00.000Z")), { ymd: "2026-11-25", min: 600 });
  assert.deepEqual(berlinClock(Date.parse("2026-07-01T22:30:00.000Z")), { ymd: "2026-07-02", min: 30 });
  assert.equal(berlinClock(Number.NaN), null);
  assert.equal(nextYmd("2026-12-31"), "2027-01-01");
  assert.equal(nextYmd("2026-03-28"), "2026-03-29");
  const today = "2026-11-25";
  assert.deepEqual(spanMinutes({ from: "2026-11-25T09:00:00.000Z", to: "2026-11-25T17:00:00.000Z" }, today), [600, 1080]);
  // Ueber Mitternacht: von gestern bis heute 02:00, von heute 18:00 bis morgen.
  assert.deepEqual(spanMinutes({ from: "2026-11-24T17:00:00.000Z", to: "2026-11-25T01:00:00.000Z" }, today), [0, 120]);
  assert.deepEqual(spanMinutes({ from: "2026-11-25T17:00:00.000Z", to: "2026-11-25T23:00:00.000Z" }, today), [1080, 1440]);
  assert.equal(spanMinutes({ from: "2026-11-26T09:00:00.000Z", to: "2026-11-26T17:00:00.000Z" }, today), null, "morgen");
  assert.equal(spanMinutes({ from: "2026-11-24T09:00:00.000Z", to: "2026-11-24T23:00:00.000Z" }, today), null, "endet um Mitternacht");
  assert.equal(spanMinutes({ from: "kaputt", to: "2026-11-25T17:00:00.000Z" }, today), null);
  // Sommerzeit beginnt am 29.03.2026: 10:00 Ortszeit ist 08:00Z.
  assert.deepEqual(spanMinutes({ from: "2026-03-29T08:00:00.000Z", to: "2026-03-29T16:00:00.000Z" }, "2026-03-29"), [600, 1080]);
  // Winterzeit beginnt am 25.10.2026: 10:00 Ortszeit ist 09:00Z.
  assert.deepEqual(spanMinutes({ from: "2026-10-25T09:00:00.000Z", to: "2026-10-25T17:00:00.000Z" }, "2026-10-25"), [600, 1080]);
});

test("nightSpans, complement und spansText", () => {
  assert.deepEqual(nightSpans("22-6"), [
    [0, 360],
    [1320, 1440],
  ]);
  assert.deepEqual(nightSpans("1-5"), [[60, 300]]);
  assert.deepEqual(nightSpans("22-0"), [[1320, 1440]]);
  assert.deepEqual(nightSpans("0"), []);
  assert.deepEqual(nightSpans("6-6"), []);
  assert.deepEqual(complement([]), [[0, 1440]]);
  assert.deepEqual(complement([[600, 1080]]), [
    [0, 600],
    [1080, 1440],
  ]);
  assert.deepEqual(complement([[0, 1440]]), []);
  assert.deepEqual(complement([[900, 1080], [600, 960], [0, 120]]), [
    [120, 600],
    [1080, 1440],
  ]);
  assert.equal(spansText([[0, 1440]]), "ganztägig");
  assert.equal(spansText([[0, 360], [1320, 1440]]), "bis 06:00 und ab 22:00");
  assert.equal(spansText([[630, 1080]]), "10:30–18:00");
});

const today = "2026-11-25";
const tcam = (id: number, name: string, over: Partial<TodayCamera>): TodayCamera => ({ id, name, mode: "raum", rooms: [], watchedNow: false, ...over });
const input = (cams: TodayCamera[], over: Partial<TodayInput> = {}): TodayInput => ({
  enabled: true,
  visionEnabled: true,
  always: false,
  nightWindow: "22-6",
  today,
  roomsDay: today,
  cams,
  ...over,
});
const shop = { name: "Shop", spans: [{ from: "2026-11-25T09:00:00.000Z", to: "2026-11-25T17:00:00.000Z" }, { from: "2026-11-26T09:00:00.000Z", to: "2026-11-26T17:00:00.000Z" }] };
const strandbad = { name: "Strandbad", spans: [] };

test("guardTodayLine: Räume, Nachtfenster und nicht bewachte Kameras", () => {
  const line = guardTodayLine(
    input([
      tcam(9, "Eingang", { rooms: [strandbad] }),
      tcam(1, "Kasse", { rooms: [shop] }),
      tcam(2, "Gastro", { rooms: [shop] }),
      tcam(3, "Lager", {}),
      tcam(4, "Steg", { mode: "nachts", rooms: [shop] }),
      tcam(5, "Büro", { mode: "aus", rooms: [shop] }),
    ])
  );
  assert.equal(
    line,
    "Heute bewacht: Strandbad ganztägig (Eingang); Shop bis 10:00 und ab 18:00 (Kasse, Gastro); nachts bis 06:00 und ab 22:00 (Lager, Steg). " +
      "Nicht bewacht: Büro (Wächter aus)."
  );
});

test("guardTodayLine: mehrere Räume, durchgehend offen, rund um die Uhr", () => {
  const gastro = { name: "Gastro", spans: [{ from: "2026-11-25T15:00:00.000Z", to: "2026-11-25T21:00:00.000Z" }] };
  assert.equal(guardTodayLine(input([tcam(1, "Kasse", { rooms: [shop, gastro] })])), "Heute bewacht: Shop/Gastro bis 10:00 und ab 22:00 (Kasse).");
  const allDay = { name: "Halle", spans: [{ from: "2026-11-24T23:00:00.000Z", to: "2026-11-25T23:00:00.000Z" }] };
  assert.equal(guardTodayLine(input([tcam(1, "Halle", { rooms: [allDay] })])), "Heute bewacht: keine Kamera. Nicht bewacht: Halle (Halle ganztägig offen).");
  assert.equal(
    guardTodayLine(input([tcam(1, "Kasse", { rooms: [shop] }), tcam(5, "Büro", { mode: "aus" })], { always: true })),
    "Heute bewacht: rund um die Uhr (Kasse). Nicht bewacht: Büro (Wächter aus)."
  );
  // „nur nachts“ bleibt auch mit always beim Nachtfenster.
  assert.equal(
    guardTodayLine(input([tcam(1, "Kasse", { rooms: [shop] }), tcam(9, "Eingang", { mode: "nachts" })], { always: true })),
    "Heute bewacht: rund um die Uhr (Kasse); nachts bis 06:00 und ab 22:00 (Eingang)."
  );
});

test("guardTodayLine: ohne Öffnungszeiten von heute gilt der Zustand von jetzt", () => {
  const cams = [tcam(1, "Kasse", { rooms: [shop], watchedNow: true }), tcam(2, "Gastro", { rooms: [{ name: "Gastro" }], watchedNow: false })];
  assert.equal(
    guardTodayLine(input(cams)),
    "Heute bewacht: Shop bis 10:00 und ab 18:00 (Kasse). Nicht bewacht: Gastro (Gastro: Öffnungszeiten von heute fehlen, jetzt nicht bewacht)."
  );
  // Raumdaten von gestern decken heute noch ab, von vorgestern nicht mehr.
  assert.match(guardTodayLine(input(cams, { roomsDay: "2026-11-24" })), /^Heute bewacht: Shop bis 10:00 und ab 18:00 \(Kasse\)/);
  assert.match(guardTodayLine(input(cams, { roomsDay: "2026-11-23" })), /^Heute bewacht: Shop jetzt, Öffnungszeiten von heute fehlen \(Kasse\)/);
  assert.match(guardTodayLine(input(cams, { roomsDay: null })), /Shop jetzt, Öffnungszeiten von heute fehlen/);
});

test("guardTodayLine: Wächter aus, Bildmodell abgeschaltet, keine Kamera", () => {
  const cams = [tcam(1, "Kasse", { rooms: [shop] })];
  assert.equal(guardTodayLine(input(cams, { enabled: false })), "Heute bewacht: nichts, der Wächter mit Bildern ist aus.");
  assert.equal(guardTodayLine(input(cams, { visionEnabled: false })), "Heute bewacht: nichts, das Bildmodell ist abgeschaltet.");
  assert.equal(guardTodayLine(input([])), "Heute bewacht: keine Kamera eingerichtet.");
  assert.equal(guardTodayLine(input([tcam(3, "Lager", {})], { nightWindow: "0" })), "Heute bewacht: keine Kamera. Nicht bewacht: Lager (kein Nachtfenster).");
});

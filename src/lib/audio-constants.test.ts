import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeMusicWindow,
  musicWindowState,
  parseOffsetMinutes,
} from "./audio-constants";
import type { ScheduleSpec } from "./operating-hours";

const TZ = "Europe/Berlin";

/** Täglich 10–20 Uhr, ganzjährig. */
function daily(): ScheduleSpec {
  return {
    name: "Park",
    seasons: [
      {
        name: "Ganzjährig",
        startMmDd: "01-01",
        endMmDd: "12-31",
        sortOrder: 0,
        periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "10:00", closesAt: "20:00" })),
      },
    ],
    exceptions: [],
  };
}

test("Versatz: ganze Minuten bis zwölf Stunden, leer und Unsinn sind ungültig", () => {
  assert.equal(parseOffsetMinutes(-30), -30);
  assert.equal(parseOffsetMinutes("45"), 45);
  assert.equal(parseOffsetMinutes(0), 0);
  assert.equal(parseOffsetMinutes(721), null);
  assert.equal(parseOffsetMinutes(1.5), null);
  assert.equal(parseOffsetMinutes(""), null);
  assert.equal(parseOffsetMinutes("abc"), null);
  assert.equal(parseOffsetMinutes(undefined), null);
});

test("ohne Kopplung oder ohne Betriebszeit ist Musik jederzeit erlaubt", () => {
  const now = new Date("2026-07-01T22:00:00Z");
  assert.deepEqual(
    musicWindowState({ musicOperating: false, musicOpenOffset: 0, musicCloseOffset: 0 }, daily(), now, TZ),
    { allowed: true, until: null },
  );
  assert.deepEqual(
    musicWindowState({ musicOperating: true, musicOpenOffset: 0, musicCloseOffset: 0 }, null, now, TZ),
    { allowed: true, until: null },
  );
});

test("Musik von Betriebsbeginn −30 bis Betriebsende +30, mit nächstem Wechsel", () => {
  const zone = { musicOperating: true, musicOpenOffset: -30, musicCloseOffset: 30 };
  // 15:00 Berlin: erlaubt bis 20:30.
  const day = musicWindowState(zone, daily(), new Date("2026-07-01T13:00:00Z"), TZ);
  assert.equal(day.allowed, true);
  assert.equal(day.until?.toISOString(), "2026-07-01T18:30:00.000Z");
  // 21:00 Berlin: gesperrt bis morgen 09:30.
  const night = musicWindowState(zone, daily(), new Date("2026-07-01T19:00:00Z"), TZ);
  assert.equal(night.allowed, false);
  assert.equal(night.until?.toISOString(), "2026-07-02T07:30:00.000Z");
});

test("Beschriftung des Musikfensters", () => {
  assert.equal(describeMusicWindow({ musicOperating: false, musicOpenOffset: -30, musicCloseOffset: 30 }), null);
  assert.equal(
    describeMusicWindow({ musicOperating: true, musicOpenOffset: 0, musicCloseOffset: 0 }),
    "Musik zur Betriebszeit",
  );
  assert.equal(
    describeMusicWindow({ musicOperating: true, musicOpenOffset: -30, musicCloseOffset: 30 }),
    "Musik von Betriebsbeginn −30 Min. bis Betriebsende +30 Min.",
  );
  assert.equal(
    describeMusicWindow({ musicOperating: true, musicOpenOffset: 0, musicCloseOffset: -60 }),
    "Musik von Betriebsbeginn bis Betriebsende −1 Std.",
  );
});

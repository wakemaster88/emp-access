import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLiftSchedule, riderOpening } from "./rider-opening";
import type { ScheduleSpec } from "./operating-hours";

// Wie „Wasserski & Shop“ im November: nur Sa/So 12–16 Uhr.
const lift: ScheduleSpec = {
  name: "Wasserski & Shop",
  seasons: [
    {
      name: "November",
      startMmDd: "11-01",
      endMmDd: "11-30",
      sortOrder: 0,
      periods: [
        { weekday: 5, opensAt: "12:00", closesAt: "16:00" },
        { weekday: 6, opensAt: "12:00", closesAt: "16:00" },
      ],
    },
  ],
  exceptions: [{ date: "2026-11-29", closed: false, opensAt: "10:30", closesAt: "18:00", note: "Sonderöffnung" }],
};

test("riderOpening: geöffnet zeigt die Zeiten von heute", () => {
  const r = riderOpening(lift, new Date("2026-11-21T13:00:00Z")); // Sa 14:00
  assert.deepEqual(r, { open: true, text: "Heute geöffnet 12–16 Uhr", note: null });
});

test("riderOpening: abends geschlossen, öffnet morgen", () => {
  const r = riderOpening(lift, new Date("2026-11-20T22:13:00Z")); // Fr 23:13
  assert.equal(r.open, false);
  assert.equal(r.text, "Öffnet morgen um 12 Uhr");
});

test("riderOpening: vor Öffnung heißt es „heute“", () => {
  assert.equal(riderOpening(lift, new Date("2026-11-21T08:00:00Z")).text, "Öffnet heute um 12 Uhr");
});

test("riderOpening: weiter weg mit Wochentag, Ausnahmetag mit Notiz", () => {
  assert.equal(riderOpening(lift, new Date("2026-11-23T10:00:00Z")).text, "Öffnet am Sa um 12 Uhr"); // Mo
  const r = riderOpening(lift, new Date("2026-11-29T10:00:00Z")); // So 11:00, Sonderöffnung
  assert.deepEqual(r, { open: true, text: "Heute geöffnet 10:30–18 Uhr", note: "Sonderöffnung" });
});

test("riderOpening: nach Saisonende ohne Plan", () => {
  assert.equal(riderOpening(lift, new Date("2026-12-01T10:00:00Z")).text, "Zurzeit keine Öffnungszeiten geplant");
});

test("pickLiftSchedule nimmt Lift-Profil, sonst Vorbelegung, sonst das einzige", () => {
  const a = { name: "Gastronomie", isDefault: true };
  const b = { name: "Wasserski & Shop", isDefault: false };
  assert.equal(pickLiftSchedule([a, b]), b);
  assert.equal(pickLiftSchedule([a, { name: "Strandbad", isDefault: false }]), a);
  const only = { name: "Strandbad", isDefault: false };
  assert.equal(pickLiftSchedule([only]), only);
  assert.equal(pickLiftSchedule([]), null);
});

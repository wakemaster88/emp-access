import { test } from "node:test";
import assert from "node:assert/strict";
import { checkinDayOpening, checkinOpeningText, pickShopSchedule } from "./checkin-opening";
import type { ScheduleSpec } from "./operating-hours";

const schedule: ScheduleSpec = {
  name: "Wasserski & Shop",
  seasons: [
    {
      name: "Ganzjahr",
      startMmDd: "01-01",
      endMmDd: "12-31",
      sortOrder: 0,
      // Sa und So 10–18, Mo zu, sonst 12–16 und 17–19.
      periods: [
        { weekday: 5, opensAt: "10:00", closesAt: "18:00" },
        { weekday: 6, opensAt: "10:00", closesAt: "18:00" },
        { weekday: 1, opensAt: "12:00", closesAt: "16:00" },
        { weekday: 1, opensAt: "17:00", closesAt: "19:30" },
      ],
    },
  ],
  exceptions: [{ date: "2026-12-06", closed: false, opensAt: "11:00", closesAt: "15:00", note: "Nikolaus" }],
};

test("pickShopSchedule nimmt erst Shop, dann Lift, dann Vorbelegung", () => {
  const a = { name: "Strandbad", isDefault: true };
  const b = { name: "Wasserski", isDefault: false };
  const c = { name: "Shop", isDefault: false };
  assert.equal(pickShopSchedule([a, b, c]), c);
  assert.equal(pickShopSchedule([a, b]), b);
  assert.equal(pickShopSchedule([a]), a);
  assert.equal(pickShopSchedule([{ name: "X", isDefault: false }, { name: "Y", isDefault: false }]), null);
});

test("Sonntag vor der Öffnung: Öffnet um 10 Uhr", () => {
  const o = checkinDayOpening(schedule, "2026-11-22");
  assert.equal(o.closed, false);
  assert.equal(o.opensAt, "2026-11-22T09:00:00.000Z");
  const early = new Date("2026-11-22T08:00:00Z");
  assert.equal(checkinOpeningText(o, "2026-11-22", "2026-11-22", early), "Öffnet um 10 Uhr · bis 18 Uhr");
});

test("Heute schon geöffnet und vergangene Tage: nichts", () => {
  const o = checkinDayOpening(schedule, "2026-11-22");
  const later = new Date("2026-11-22T10:30:00Z");
  assert.equal(checkinOpeningText(o, "2026-11-22", "2026-11-22", later), null);
  assert.equal(checkinOpeningText(o, "2026-11-22", "2026-11-23", later), null);
});

test("Künftiger Tag zeigt die Spannen, Montag ist zu", () => {
  const now = new Date("2026-11-22T10:30:00Z");
  const tue = checkinDayOpening(schedule, "2026-11-24");
  assert.equal(checkinOpeningText(tue, "2026-11-24", "2026-11-22", now), "Geöffnet 12–16 und 17–19:30 Uhr");
  const mon = checkinDayOpening(schedule, "2026-11-23");
  assert.equal(mon.closed, true);
  assert.equal(checkinOpeningText(mon, "2026-11-23", "2026-11-22", now), "Geschlossen");
});

test("Ausnahmetag mit Notiz", () => {
  const o = checkinDayOpening(schedule, "2026-12-06");
  assert.equal(checkinOpeningText(o, "2026-12-06", "2026-11-22", new Date("2026-11-22T10:00:00Z")), "Geöffnet 11–15 Uhr · Nikolaus");
});

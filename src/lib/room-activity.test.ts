import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoomActivity, dayStart } from "./room-activity";

const tz = "Europe/Berlin";
const now = new Date("2026-11-04T11:00:00Z"); // 12:00 Berlin

test("Tagesbeginn in Berlin", () => {
  assert.equal(dayStart(now, tz).toISOString(), "2026-11-03T23:00:00.000Z");
});

test("Stunden, Anwesenheit und Personen je Raum", () => {
  const a = buildRoomActivity(
    [
      { roomId: 1, startedAt: new Date("2026-11-04T08:10:00Z"), endedAt: new Date("2026-11-04T08:11:00Z") },
      { roomId: 1, startedAt: new Date("2026-11-04T10:58:00Z"), endedAt: null },
      { roomId: 2, startedAt: new Date("2026-11-04T09:00:00Z"), endedAt: new Date("2026-11-04T09:05:00Z") },
    ],
    [
      { roomId: 1, seenAt: new Date("2026-11-04T08:10:00Z"), person: { name: "Max", listType: "WHITELIST" } },
      { roomId: 1, seenAt: new Date("2026-11-04T10:58:00Z"), person: { name: "Max", listType: "WHITELIST" } },
      { roomId: 1, seenAt: new Date("2026-11-04T10:00:00Z"), person: null },
    ],
    now,
    tz,
  );
  const r1 = a.get(1)!;
  assert.equal(r1.total, 2);
  assert.equal(r1.hours[9], 1); // 09:10 Berlin
  assert.equal(r1.hours[11], 1);
  assert.equal(r1.present, true);
  assert.deepEqual(r1.people.map((p) => [p.name, p.count]), [["Max", 2]]);
  assert.equal(r1.unknown, 1);
  assert.equal(a.get(2)!.present, false);
});

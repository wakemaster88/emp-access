import { test } from "node:test";
import assert from "node:assert/strict";
import { motionEventAt, readMotion } from "./room-motion";
import { buildRoomActivity } from "./room-activity";

const now = new Date("2026-11-04T11:00:00Z");
const unix = (d: Date) => d.getTime() / 1000;

test("Bewegung aus Gen2/BLU und Gen1 lesen, andere Geräte ignorieren", () => {
  assert.deepEqual(readMotion({ "motion:0": { motion: true, ts: unix(now) } }), { motion: true, lastMotionAt: now });
  assert.deepEqual(readMotion({ sensor: { motion: false, timestamp: unix(now) } }), { motion: false, lastMotionAt: now });
  assert.equal(readMotion({ sensor: { state: "open" } }), null);
  assert.equal(readMotion({ "switch:0": { output: true } }), null);
});

test("Ereigniszeit: Zeitstempel des Melders, sonst volle Minute bei Bewegung", () => {
  const twoMinAgo = new Date(now.getTime() - 120_000);
  assert.deepEqual(motionEventAt({ motion: false, lastMotionAt: twoMinAgo }, now), twoMinAgo);
  // Zu alt: nicht nachtragen
  assert.equal(motionEventAt({ motion: false, lastMotionAt: new Date(now.getTime() - 3600_000) }, now), null);
  assert.deepEqual(motionEventAt({ motion: true, lastMotionAt: null }, new Date("2026-11-04T11:00:42Z")), now);
  assert.equal(motionEventAt({ motion: false, lastMotionAt: null }, now), null);
});

test("Bewegungen zählen im Ereignis-Widget und machen den Raum besetzt", () => {
  const a = buildRoomActivity([], [], now, "Europe/Berlin", [
    { roomId: 5, at: new Date("2026-11-04T09:10:00Z") },
    { roomId: 5, at: new Date(now.getTime() - 60_000) },
  ]).get(5)!;
  assert.equal(a.total, 2);
  assert.equal(a.motion, 2);
  assert.equal(a.present, true);
  assert.equal(a.hours[10], 1); // 09:10 UTC = 10:10 Berlin
});

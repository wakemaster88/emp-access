import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDoorbellPush, doorbellPushUrl, isFreshDoorbell, DOORBELL_PUSH_MAX_AGE_MS } from "./doorbell-push";

test("Klingel-Push: Text, Ziel und Tag", () => {
  const p = buildDoorbellPush({ id: 11, name: "Tor" }, new Date("2026-11-15T12:30:00Z"));
  assert.equal(p.title, "🔔 Es hat geklingelt");
  assert.match(p.body, /^Tor · 13:30 Uhr/);
  assert.equal(p.url, doorbellPushUrl(11));
  assert.equal(p.tag, "doorbell-11");
  assert.equal(p.requireInteraction, true);
});

test("Klingel-Push: alte Meldungen werden nicht gepusht", () => {
  const now = new Date("2026-11-15T12:30:00Z");
  assert.equal(isFreshDoorbell(new Date(now.getTime() - 5_000), now), true);
  assert.equal(isFreshDoorbell(new Date(now.getTime() - DOORBELL_PUSH_MAX_AGE_MS - 1), now), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKED_NOTIFY_INTERVAL_MS, formatBlockedAlert, shouldNotifyBlocked } from "./blocked-devices-format";

test("gesperrtes Geraet: erste Sichtung meldet, danach gedrosselt", () => {
  const now = new Date("2026-11-05T16:00:00Z");
  assert.equal(shouldNotifyBlocked(null, now), true);
  assert.equal(shouldNotifyBlocked(new Date(now.getTime() - 60_000), now), false);
  assert.equal(shouldNotifyBlocked(new Date(now.getTime() - BLOCKED_NOTIFY_INTERVAL_MS), now), true);
});

test("Meldetext nennt Name, IP, MAC und ob Insight die Sperre schon hat", () => {
  const one = formatBlockedAlert([
    { name: "Max <iPhone>", macAddress: "4A:57:54:EA:A8:A7", ip: "192.168.1.114", enforced: true },
  ]);
  assert.match(one, /^🚫 Gesperrtes Gerät im Netz/);
  assert.match(one, /<b>Max &lt;iPhone&gt;<\/b>/);
  assert.match(one, /IP 192\.168\.1\.114 · MAC 4A:57:54:EA:A8:A7/);
  assert.match(one, /in Insight eingetragen, das Gerät kommt trotzdem rein/);

  const two = formatBlockedAlert([
    { name: "A", macAddress: "AA:AA:AA:AA:AA:AA", ip: null, enforced: false },
    { name: "B", macAddress: "BB:BB:BB:BB:BB:BB", ip: null, enforced: false },
  ]);
  assert.match(two, /^🚫 2 gesperrte Geräte im Netz/);
  assert.match(two, /noch nicht in Insight eingetragen/);
});

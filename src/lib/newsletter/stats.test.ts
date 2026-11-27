import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignStats, percent } from "./stats";

test("campaignStats: zählt Zustände zusammen", () => {
  const s = campaignStats(
    [
      { status: "DELIVERED", count: 90 },
      { status: "SENT", count: 4 },
      { status: "BOUNCED", count: 3 },
      { status: "COMPLAINED", count: 1 },
      { status: "FAILED", count: 1 },
      { status: "QUEUED", count: 1 },
    ],
    2,
  );
  assert.equal(s.total, 100);
  assert.equal(s.sent, 98);
  assert.equal(s.delivered, 91);
  assert.equal(s.bounced, 3);
  assert.equal(s.waiting, 1);
  assert.equal(s.unsubscribed, 2);
  assert.equal(s.progress, 99);
});

test("campaignStats: leer", () => {
  const s = campaignStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.progress, 0);
});

test("percent", () => {
  assert.equal(percent(1, 4), "25 %");
  assert.equal(percent(1, 400), "0,3 %");
  assert.equal(percent(0, 0), "–");
});

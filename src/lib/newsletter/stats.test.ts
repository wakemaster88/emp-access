import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSpan, campaignStats, percent, recentChange, subscriberTimeline, type TimelineSubscriber } from "./stats";

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

const NOW2 = new Date("2026-11-27T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW2.getTime() - d * 86_400_000);
const sub = (p: Partial<TimelineSubscriber>): TimelineSubscriber => ({
  status: "ACTIVE", source: "website", confirmedAt: null, consentAt: null, createdAt: daysAgo(100),
  unsubscribedAt: null, bouncedAt: null, complainedAt: null, ...p,
});

test("activeSpan: Double-Opt-in ab Bestätigung, Übernahmen ab Eintrag, offene nie", () => {
  assert.equal(activeSpan(sub({ status: "PENDING" })), null);
  assert.equal(activeSpan(sub({ status: "UNSUBSCRIBED", unsubscribedAt: daysAgo(1) })), null, "nie bestätigt");
  assert.deepEqual(activeSpan(sub({ confirmedAt: daysAgo(10) })), { from: daysAgo(10), to: null });
  assert.deepEqual(activeSpan(sub({ consentAt: daysAgo(5) })), { from: daysAgo(5), to: null }, "angemeldet ohne Bestätigung zählt");
  assert.deepEqual(activeSpan(sub({ source: "wakesys", consentAt: daysAgo(3) })), { from: daysAgo(3), to: null });
  assert.deepEqual(activeSpan(sub({ source: "anny", status: "UNSUBSCRIBED", consentAt: daysAgo(20), unsubscribedAt: daysAgo(2) })), {
    from: daysAgo(20),
    to: daysAgo(2),
  });
  assert.deepEqual(activeSpan(sub({ status: "BOUNCED", confirmedAt: daysAgo(9), bouncedAt: daysAgo(4) })), { from: daysAgo(9), to: daysAgo(4) });
});

test("subscriberTimeline: angemeldet am Wochenende, neu und gegangen je Woche", () => {
  const rows = [
    sub({ confirmedAt: daysAgo(20) }),
    sub({ source: "wakesys", consentAt: daysAgo(2) }),
    sub({ source: "wakesys", consentAt: daysAgo(2) }),
    sub({ status: "UNSUBSCRIBED", confirmedAt: daysAgo(15), unsubscribedAt: daysAgo(3) }),
  ];
  const t = subscriberTimeline(rows, 3, NOW2);
  assert.equal(t.length, 3);
  assert.deepEqual(t.map((p) => p.active), [2, 2, 3]);
  assert.deepEqual(t.map((p) => p.joined), [2, 0, 2]);
  assert.deepEqual(t.map((p) => p.left), [0, 0, 1]);
  assert.equal(t[2].end.getTime(), NOW2.getTime());
  assert.deepEqual(recentChange(rows, 30, NOW2), { joined: 4, left: 1 });
});

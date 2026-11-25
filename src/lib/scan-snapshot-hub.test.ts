import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearScanSnapshotHubCache,
  hubSeenRecently,
  shouldQueueScanSnapshot,
  SNAPSHOT_HUB_SEEN_WITHIN_MS,
} from "./scan-snapshot-hub";

const NOW = Date.parse("2026-11-24T10:00:00Z");

function fakeDb(lastSeenAt: Date | null | "none" | "fail") {
  const calls: unknown[] = [];
  return {
    calls,
    db: {
      hubAgent: {
        async findFirst(args: {
          where: { accountId: number; lastSeenAt: { not: null } };
          orderBy: { lastSeenAt: "desc" };
          select: { lastSeenAt: true };
        }) {
          calls.push(args);
          if (lastSeenAt === "fail") throw new Error("db down");
          return lastSeenAt === "none" ? null : { lastSeenAt };
        },
      },
    },
  };
}

test("hubSeenRecently: bis 5 Minuten ja, darüber oder nie nein", () => {
  assert.equal(SNAPSHOT_HUB_SEEN_WITHIN_MS, 5 * 60_000);
  assert.equal(hubSeenRecently(new Date(NOW - 10_000), NOW), true);
  assert.equal(hubSeenRecently(new Date(NOW - SNAPSHOT_HUB_SEEN_WITHIN_MS), NOW), true);
  assert.equal(hubSeenRecently(new Date(NOW - 6 * 60_000), NOW), false);
  assert.equal(hubSeenRecently(null, NOW), false);
  assert.equal(hubSeenRecently(undefined, NOW), false);
});

test("shouldQueueScanSnapshot: Hub vor 10 s gemeldet, Auftrag anlegen", async () => {
  clearScanSnapshotHubCache();
  const f = fakeDb(new Date(NOW - 10_000));
  assert.equal(await shouldQueueScanSnapshot(f.db, 1, () => NOW), true);
  assert.deepEqual(f.calls[0], {
    where: { accountId: 1, lastSeenAt: { not: null } },
    orderBy: { lastSeenAt: "desc" },
    select: { lastSeenAt: true },
  });
});

test("shouldQueueScanSnapshot: Hub vor 6 Minuten oder nie, kein Auftrag", async () => {
  clearScanSnapshotHubCache();
  assert.equal(await shouldQueueScanSnapshot(fakeDb(new Date(NOW - 6 * 60_000)).db, 1, () => NOW), false);
  assert.equal(await shouldQueueScanSnapshot(fakeDb("none").db, 2, () => NOW), false);
  assert.equal(await shouldQueueScanSnapshot(fakeDb(null).db, 3, () => NOW), false);
});

test("shouldQueueScanSnapshot: Abfrage scheitert, Auftrag anlegen wie bisher, nicht gespeichert", async () => {
  clearScanSnapshotHubCache();
  const failing = fakeDb("fail");
  assert.equal(await shouldQueueScanSnapshot(failing.db, 1, () => NOW), true);
  const later = fakeDb("none");
  assert.equal(await shouldQueueScanSnapshot(later.db, 1, () => NOW), false);
  assert.equal(later.calls.length, 1);
});

test("shouldQueueScanSnapshot: 60 s im Speicher je Account, keine zweite Abfrage", async () => {
  clearScanSnapshotHubCache();
  const f = fakeDb(new Date(NOW - 10_000));
  assert.equal(await shouldQueueScanSnapshot(f.db, 1, () => NOW), true);
  assert.equal(await shouldQueueScanSnapshot(f.db, 1, () => NOW), true);
  assert.equal(f.calls.length, 1);
  // Anderer Account: eigene Abfrage.
  const g = fakeDb("none");
  assert.equal(await shouldQueueScanSnapshot(g.db, 2, () => NOW), false);
  assert.equal(await shouldQueueScanSnapshot(g.db, 2, () => NOW), false);
  assert.equal(g.calls.length, 1);
  assert.equal(f.calls.length, 1);
});

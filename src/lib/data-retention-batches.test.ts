import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteInBatches, type BatchOps } from "./data-retention-batches";
import { RETENTION_BATCH, RETENTION_BUDGET_MS, RETENTION_MAX_ROWS, retentionRestLine } from "./data-retention-rules";

/*
 * Der Ablauf in Portionen gegen eine Tabelle im Speicher: Zeilen mit ID,
 * Blob-Pfad (jede dritte) und ob sie noch unter die Frist fallen.
 */
function table(n: number) {
  const rows = new Map<number, { blob: string | null; due: boolean }>();
  for (let id = 1; id <= n; id++) rows.set(id, { blob: id % 3 === 0 ? `scan-snapshots/${id}.jpg` : null, due: true });
  let clock = 1_000_000;
  const seen = { finds: [] as number[], removes: [] as number[], dropped: [] as string[], log: [] as string[] };
  const due = () => [...rows].filter(([, r]) => r.due);
  const ops: BatchOps & { tick: number; beforeRemove?: () => void } = {
    tick: 0,
    find: async (take) => {
      seen.finds.push(take);
      return due()
        .slice(0, take)
        .map(([id, r]) => ({ id, blob: r.blob }));
    },
    remove: async (ids) => {
      ops.beforeRemove?.();
      let k = 0;
      for (const id of ids) {
        if (rows.get(id)?.due) {
          rows.delete(id);
          k++;
        }
      }
      seen.removes.push(k);
      clock += ops.tick;
      return k;
    },
    existing: async (ids) => ids.filter((id) => rows.has(id)),
    count: async () => due().length,
    dropBlobs: async (paths) => {
      for (const p of paths) if (p) seen.dropped.push(p);
    },
    now: () => clock,
    log: (line) => seen.log.push(line),
  };
  return { rows, ops, seen, budget: () => ({ untilMs: clock + RETENTION_BUDGET_MS }), due };
}

test("Portionen: 1.234 faellige Zeilen in 500, 500 und 234, ohne Rest und ohne Log-Zeile", async () => {
  const t = table(1_234);
  const remaining = {};
  assert.equal(await deleteInBatches(1, "scanSnapshots", t.budget(), remaining, t.ops), 1_234);
  assert.deepEqual(t.seen.removes, [500, 500, 234]);
  assert.deepEqual(t.seen.finds, [500, 500, 500]);
  assert.deepEqual(remaining, {});
  assert.deepEqual(t.seen.log, []);
  assert.equal(t.rows.size, 0);
  assert.equal(t.seen.dropped.length, Math.floor(1_234 / 3));
});

test("Obergrenze: 7.812 Scan-Fotos brauchen vier Laeufe zu hoechstens 2.000 Zeilen, der Rest steht im Ergebnis und im Log", async () => {
  assert.equal(RETENTION_BATCH, 500);
  assert.equal(RETENTION_MAX_ROWS, 2_000);
  const t = table(7_812);
  const runs: Array<{ deleted: number; remaining: Record<string, number> }> = [];
  for (let i = 0; i < 4; i++) {
    const remaining: Record<string, number> = {};
    t.seen.removes.length = 0;
    const deleted = await deleteInBatches(1, "scanSnapshots", t.budget(), remaining, t.ops);
    assert.ok(t.seen.removes.every((k) => k <= 500), `Lauf ${i + 1}: Portionen ${t.seen.removes}`);
    runs.push({ deleted, remaining });
  }
  assert.deepEqual(runs, [
    { deleted: 2_000, remaining: { scanSnapshots: 5_812 } },
    { deleted: 2_000, remaining: { scanSnapshots: 3_812 } },
    { deleted: 2_000, remaining: { scanSnapshots: 1_812 } },
    { deleted: 1_812, remaining: {} },
  ]);
  assert.deepEqual(t.seen.log, [
    retentionRestLine(1, "scanSnapshots", 2_000, 5_812),
    retentionRestLine(1, "scanSnapshots", 2_000, 3_812),
    retentionRestLine(1, "scanSnapshots", 2_000, 1_812),
  ]);
  assert.equal(t.rows.size, 0);
});

test("Zeitbudget: nach Ablauf keine weitere Portion, der Rest folgt im naechsten Lauf", async () => {
  const t = table(3_000);
  // Jede Portion dauert 40 s: Nach 0, 40 und 80 s je eine, bei 120 s ist das Budget von 90 s um.
  t.ops.tick = 40_000;
  const remaining: Record<string, number> = {};
  assert.equal(await deleteInBatches(2, "personSightingsUnknown", t.budget(), remaining, t.ops), 1_500);
  assert.deepEqual(remaining, { personSightingsUnknown: 1_500 });
  assert.deepEqual(t.seen.log, [retentionRestLine(2, "personSightingsUnknown", 1_500, 1_500)]);
  // Budget schon verbraucht (anderes Konto vorher): nichts abgefragt, nichts geloescht.
  const u = table(10);
  const rest: Record<string, number> = {};
  assert.equal(await deleteInBatches(3, "scanSnapshots", { untilMs: 0 }, rest, u.ops), 0);
  assert.deepEqual(u.seen.finds, []);
  assert.deepEqual(rest, { scanSnapshots: 10 });
});

test("Blobs nur von Zeilen, die wirklich geloescht wurden", async () => {
  const t = table(9);
  // Zwischen Abfrage und Loeschen wird Zeile 3 (mit Blob) einer Person zugeordnet: Sie faellt nicht mehr unter die Frist.
  t.ops.beforeRemove = () => {
    const r = t.rows.get(3);
    if (r) r.due = false;
    t.ops.beforeRemove = undefined;
  };
  assert.equal(await deleteInBatches(1, "personSightingsUnknown", t.budget(), {}, t.ops), 8);
  assert.deepEqual(t.seen.dropped, ["scan-snapshots/6.jpg", "scan-snapshots/9.jpg"]);
  assert.deepEqual([...t.rows.keys()], [3]);
});

test("Nichts faellig: eine Abfrage, kein Loeschen", async () => {
  const t = table(0);
  const remaining = {};
  assert.equal(await deleteInBatches(1, "scanSnapshots", t.budget(), remaining, t.ops), 0);
  assert.deepEqual(t.seen.finds, [500]);
  assert.deepEqual(t.seen.removes, []);
  assert.deepEqual(remaining, {});
});

test("Laesst sich keine Zeile einer vollen Portion loeschen, endet der Schritt mit dem Rest", async () => {
  const t = table(600);
  t.ops.remove = async () => 0;
  const remaining: Record<string, number> = {};
  assert.equal(await deleteInBatches(1, "scanSnapshots", t.budget(), remaining, t.ops), 0);
  assert.deepEqual(t.seen.finds, [500]);
  assert.deepEqual(remaining, { scanSnapshots: 600 });
  assert.deepEqual(t.seen.dropped, []);
});

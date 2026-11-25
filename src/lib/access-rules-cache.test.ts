import { test } from "node:test";
import assert from "node:assert/strict";
import { clearAccessRulesCache, loadAreaHasExitReader } from "./access-rules-cache";

function fakeDb(exitAreas: Set<string>) {
  const calls: Array<Record<string, unknown>> = [];
  let fail = false;
  return {
    calls,
    setFail(v: boolean) {
      fail = v;
    },
    db: {
      device: {
        async findFirst(args: {
          where: {
            accountId: number;
            type: "RASPBERRY_PI";
            isActive: true;
            accessOut: number;
            OR: [{ accessIn: null }, { accessIn: { not: number } }];
          };
          select: { id: true };
        }) {
          calls.push(args.where);
          if (fail) throw new Error("db down");
          return exitAreas.has(`${args.where.accountId}:${args.where.accessOut}`) ? { id: 1 } : null;
        },
      },
    },
  };
}

test("loadAreaHasExitReader: aktiver Scanner-Pi mit Bereich als Ausgang, je Account und Bereich", async () => {
  clearAccessRulesCache();
  const f = fakeDb(new Set(["1:5"]));
  assert.equal(await loadAreaHasExitReader(f.db, 1, 5), true);
  assert.equal(await loadAreaHasExitReader(f.db, 1, 7), false);
  assert.equal(await loadAreaHasExitReader(f.db, 2, 5), false);
  // Ein Leser mit demselben Bereich als Ein- und Ausgang zählt nicht.
  assert.deepEqual(f.calls[0], {
    accountId: 1,
    type: "RASPBERRY_PI",
    isActive: true,
    accessOut: 5,
    OR: [{ accessIn: null }, { accessIn: { not: 5 } }],
  });
  assert.equal(f.calls.length, 3);
  // Zwischenspeicher: keine weitere Abfrage.
  assert.equal(await loadAreaHasExitReader(f.db, 1, 5), true);
  assert.equal(await loadAreaHasExitReader(f.db, 1, 7), false);
  assert.equal(f.calls.length, 3);
  // Speichern der Regeln leert auch diesen Speicher.
  clearAccessRulesCache();
  assert.equal(await loadAreaHasExitReader(f.db, 1, 7), false);
  assert.equal(f.calls.length, 4);
});

test("loadAreaHasExitReader: Fehler wird weitergegeben und nicht gespeichert", async () => {
  clearAccessRulesCache();
  const f = fakeDb(new Set(["1:5"]));
  f.setFail(true);
  await assert.rejects(loadAreaHasExitReader(f.db, 1, 5));
  f.setFail(false);
  assert.equal(await loadAreaHasExitReader(f.db, 1, 5), true);
  assert.equal(f.calls.length, 2);
});

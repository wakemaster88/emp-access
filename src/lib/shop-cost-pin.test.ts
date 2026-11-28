import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShopCostPinDb } from "./shop-cost-pin";
import * as pins from "./shop-cost-pin";

// secret-box leitet den Schluessel erst beim ersten Gebrauch ab.
process.env.AUTH_SECRET ||= "test-secret-nur-fuer-tests";

const { SHOP_COST_PIN_MAX_FAILURES, SHOP_COST_PIN_LOCK_MINUTES, SHOP_COST_UNLOCK_MINUTES } = pins;

const NOW = new Date("2026-11-28T12:00:00Z");
const ACCOUNT = 7;
const MONITOR = 42;

interface Row {
  accountId: number;
  pinHash: string;
  pinSetAt: Date;
  failures: number;
  lockedUntil: Date | null;
  lastAttemptAt: Date | null;
}

type Cond = Record<string, unknown>;

function matches(row: Row, where: Cond): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key as keyof Row] as unknown;
    if (cond === null) {
      if (value !== null) return false;
    } else if (typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { lt?: number | Date; lte?: number | Date; gte?: number | Date };
      if (value === null || value === undefined) return false;
      if (c.lt !== undefined && !((value as number) < (c.lt as number))) return false;
      if (c.lte !== undefined && !((value as number) <= (c.lte as number))) return false;
      if (c.gte !== undefined && !((value as number) >= (c.gte as number))) return false;
    } else if (value !== cond) return false;
  }
  return true;
}

/** Attrappe mit genau den Bedingungen, die shop-cost-pin.ts benutzt. */
function fakeDb() {
  const rows: Row[] = [];
  const db: ShopCostPinDb = {
    shopCostPin: {
      async findUnique({ where }) {
        const r = rows.find((x) => x.accountId === where.accountId);
        return r ? { pinHash: r.pinHash, pinSetAt: r.pinSetAt, lockedUntil: r.lockedUntil } : null;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const r of rows) {
          if (!matches(r, where)) continue;
          count += 1;
          for (const [key, v] of Object.entries(data)) {
            if (v && typeof v === "object" && "increment" in v) (r as unknown as Record<string, number>)[key] += (v as { increment: number }).increment;
            else (r as unknown as Record<string, unknown>)[key] = v;
          }
        }
        return { count };
      },
      async upsert({ where, create, update }) {
        const r = rows.find((x) => x.accountId === where.accountId);
        if (r) Object.assign(r, update);
        else rows.push(create as unknown as Row);
        return null;
      },
      async deleteMany({ where }) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i]!, where)) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
  };
  return { db, rows };
}

test("checkShopCostPin: richtige PIN, falsche PIN, ohne PIN", async () => {
  const { db, rows } = fakeDb();
  assert.deepEqual(await pins.checkShopCostPin(ACCOUNT, "482915", NOW, db), { ok: false, reason: "missing" });
  await pins.setShopCostPin(ACCOUNT, "482915", NOW, db);
  assert.notEqual(rows[0]!.pinHash, "482915", "nur der Hash steht in der Datenbank");
  assert.deepEqual(await pins.checkShopCostPin(ACCOUNT, "482915", NOW, db), { ok: true, pinSetAt: NOW });
  assert.equal(rows[0]!.failures, 0);
  assert.deepEqual(await pins.checkShopCostPin(ACCOUNT, "482916", NOW, db), { ok: false, reason: "wrong" });
  assert.equal(rows[0]!.failures, 1);
  // Unsinn zaehlt als Fehlversuch, ohne bcrypt zu bemuehen
  assert.deepEqual(await pins.checkShopCostPin(ACCOUNT, "abc", NOW, db), { ok: false, reason: "wrong" });
  assert.equal(rows[0]!.failures, 2);
  // Richtige PIN setzt den Zaehler zurueck
  assert.equal((await pins.checkShopCostPin(ACCOUNT, "482915", NOW, db)).ok, true);
  assert.equal(rows[0]!.failures, 0);
});

test("checkShopCostPin: sperrt nach 5 Fehlversuchen, auch die richtige PIN", async () => {
  const { db, rows } = fakeDb();
  await pins.setShopCostPin(ACCOUNT, "482915", NOW, db);
  for (let i = 1; i < SHOP_COST_PIN_MAX_FAILURES; i++) {
    assert.equal((await pins.checkShopCostPin(ACCOUNT, "000000", NOW, db)).ok, false);
  }
  const last = await pins.checkShopCostPin(ACCOUNT, "000000", NOW, db);
  const until = new Date(NOW.getTime() + SHOP_COST_PIN_LOCK_MINUTES * 60_000);
  assert.deepEqual(last, { ok: false, reason: "locked", lockedUntil: until });
  // Waehrend der Sperre hilft auch die richtige PIN nicht, und es zaehlt nichts dazu.
  assert.deepEqual(await pins.checkShopCostPin(ACCOUNT, "482915", new Date(NOW.getTime() + 60_000), db), {
    ok: false,
    reason: "locked",
    lockedUntil: until,
  });
  assert.equal(rows[0]!.failures, SHOP_COST_PIN_MAX_FAILURES);
  // Nach der Sperre geht es wieder, der Zaehler beginnt neu.
  const later = new Date(until.getTime() + 1_000);
  assert.equal((await pins.checkShopCostPin(ACCOUNT, "482915", later, db)).ok, true);
  assert.equal(rows[0]!.failures, 0);
  assert.equal(rows[0]!.lockedUntil, null);
});

test("setShopCostPin: neue PIN hebt die Sperre auf, nur 4 bis 8 Ziffern", async () => {
  const { db, rows } = fakeDb();
  await pins.setShopCostPin(ACCOUNT, "482915", NOW, db);
  rows[0]!.failures = SHOP_COST_PIN_MAX_FAILURES;
  rows[0]!.lockedUntil = new Date(NOW.getTime() + 600_000);
  const later = new Date(NOW.getTime() + 60_000);
  await pins.setShopCostPin(ACCOUNT, "7305281", later, db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.failures, 0);
  assert.equal(rows[0]!.lockedUntil, null);
  assert.deepEqual(await pins.checkShopCostPin(ACCOUNT, "7305281", later, db), { ok: true, pinSetAt: later });
  await assert.rejects(pins.setShopCostPin(ACCOUNT, "123", NOW, db));
  await pins.setShopCostPin(ACCOUNT, "4829", NOW, db);
  assert.deepEqual(await pins.checkShopCostPin(ACCOUNT, "4829", NOW, db), { ok: true, pinSetAt: NOW });
  await assert.rejects(pins.setShopCostPin(ACCOUNT, "123456789", NOW, db));
  await pins.removeShopCostPin(ACCOUNT, db);
  assert.equal(rows.length, 0);
});

test("Freischaltung: gilt nur fuer Mandant, Monitor und PIN, und nur 30 Minuten", () => {
  const pinSetAt = new Date("2026-11-28T11:00:00Z");
  const { unlock, expiresAt } = pins.issueShopCostUnlock(ACCOUNT, MONITOR, pinSetAt, NOW);
  assert.equal(expiresAt, new Date(NOW.getTime() + SHOP_COST_UNLOCK_MINUTES * 60_000).toISOString());
  assert.equal(SHOP_COST_UNLOCK_MINUTES, 30);
  assert.doesNotMatch(unlock, /[{"]/, "der Inhalt ist verschluesselt");
  assert.equal(pins.shopCostUnlockValid(unlock, ACCOUNT, MONITOR, pinSetAt, NOW), true);
  assert.equal(pins.shopCostUnlockValid(unlock, ACCOUNT, MONITOR, pinSetAt, new Date(NOW.getTime() + 29 * 60_000)), true);
  assert.equal(pins.shopCostUnlockValid(unlock, ACCOUNT, MONITOR, pinSetAt, new Date(NOW.getTime() + 30 * 60_000)), false);
  assert.equal(pins.shopCostUnlockValid(unlock, 8, MONITOR, pinSetAt, NOW), false, "anderer Mandant");
  assert.equal(pins.shopCostUnlockValid(unlock, ACCOUNT, 43, pinSetAt, NOW), false, "anderer Monitor");
  assert.equal(pins.shopCostUnlockValid(unlock, ACCOUNT, MONITOR, new Date("2026-11-28T11:30:00Z"), NOW), false, "neue PIN");
  assert.equal(pins.shopCostUnlockValid(unlock.slice(0, -2) + "xx", ACCOUNT, MONITOR, pinSetAt, NOW), false, "veraendert");
  assert.equal(pins.shopCostUnlockValid("v1.a.b.c", ACCOUNT, MONITOR, pinSetAt, NOW), false);
});

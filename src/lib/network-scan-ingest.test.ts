import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestHubScanDevices } from "./network-scan-ingest";

/*
 * Abgleich eines Scans gegen eine Datenbank-Attrappe: Sie haelt
 * DiscoveredDevice-Zeilen, wertet die einfachen Filter des Abgleichs aus
 * (accountId, in, notIn) und merkt sich jede Schreibung. Clients,
 * Infrastruktur, Sperrliste und bekannte MACs sind leer bzw. schon bekannt,
 * damit keine Meldung hinausgeht.
 */

const ACCOUNT = 7;

type Row = { id: number; accountId: number; macAddress: string; ipAddress: string | null; [k: string]: unknown };

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const v = row[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      const c = cond as { in?: unknown[]; notIn?: unknown[] };
      if (c.in && !c.in.includes(v)) return false;
      if (c.notIn && c.notIn.includes(v)) return false;
    } else if (v !== cond) return false;
  }
  return true;
}

function fakeDb(rows: Row[]) {
  const writes: Array<{ op: string; args: { where?: Record<string, unknown>; data?: unknown } }> = [];
  const rec = (op: string) => (args: { where?: Record<string, unknown>; data?: unknown }) => {
    writes.push({ op, args });
    return Promise.resolve({ count: 1 });
  };
  const db = {
    discoveredDevice: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)),
      createMany: rec("discoveredDevice.createMany"),
      updateMany: rec("discoveredDevice.updateMany"),
      deleteMany: rec("discoveredDevice.deleteMany"),
    },
    knownNetworkDevice: {
      count: async () => 1,
      findMany: async ({ where }: { where: { macAddress: { in: string[] } } }) => where.macAddress.in.map((macAddress) => ({ macAddress })),
    },
    blockedNetworkDevice: { findMany: async () => [] },
    networkClient: { findMany: async () => [], updateMany: rec("networkClient.updateMany") },
    networkDevice: { findMany: async () => [], updateMany: rec("networkDevice.updateMany") },
    networkVlan: { findMany: async () => [] },
    device: { findMany: async () => [] },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  };
  return { db: db as never, writes };
}

const lastSeenAt = new Date("2026-11-26T09:30:00.000Z");
const stored = (id: number, ip: string, o: Partial<Row> = {}): Row => ({
  id,
  accountId: ACCOUNT,
  macAddress: `02:00:00:00:00:${id.toString(16).padStart(2, "0").toUpperCase()}`,
  ipAddress: ip,
  iface: "en0",
  hostname: null,
  vendor: null,
  openPorts: [80],
  deviceType: null,
  responseMs: 3,
  reachable: true,
  absentScans: 0,
  hubName: "hub",
  ipHistory: null,
  lastSeenAt,
  ...o,
});
const scanned = (row: Row, o: Record<string, unknown> = {}) => ({
  ip: row.ipAddress,
  mac: row.macAddress,
  iface: "en0",
  openPorts: [80],
  responseMs: 5,
  reachable: true,
  ...o,
});

test("Unveraendertes Netz: eine gemeinsame Schreibung statt einer je Geraet", async () => {
  const rows = [stored(1, "192.168.1.11"), stored(2, "192.168.1.12"), stored(3, "192.168.1.13")];
  const { db, writes } = fakeDb(rows);
  const res = await ingestHubScanDevices(db, ACCOUNT, rows.map((r) => scanned(r)), "hub");
  assert.equal(res.processed, 3);
  assert.deepEqual(
    writes.map((w) => w.op),
    ["discoveredDevice.updateMany"]
  );
  assert.deepEqual(Object.keys(writes[0].args.data as object), ["lastSeenAt"]);
});

test("Geaenderte einzeln, unveraenderte gemeinsam, fehlende in einer Schreibung; alles am Konto", async () => {
  const rows = [
    stored(1, "192.168.1.11"),
    stored(2, "192.168.1.12"),
    // Fehlt im Scan: zugeordnet waere es nicht, also beim zweiten Fehlen weg.
    stored(3, "192.168.1.13", { absentScans: 1 }),
    stored(4, "192.168.1.14"),
  ];
  const { db, writes } = fakeDb(rows);
  await ingestHubScanDevices(db, ACCOUNT, [scanned(rows[0]), scanned(rows[1], { openPorts: [80, 443] })], "hub");
  const ops = writes.map((w) => w.op);
  assert.deepEqual(ops, [
    "discoveredDevice.updateMany", // Geraet 2 geaendert
    "discoveredDevice.updateMany", // Geraet 1 unveraendert
    "discoveredDevice.updateMany", // Geraet 4 fehlt zum ersten Mal: Zaehler +1
    "discoveredDevice.deleteMany", // Geraet 3 fehlt zum zweiten Mal
  ]);
  assert.deepEqual(writes[2].args.data, { absentScans: { increment: 1 }, reachable: false });
  assert.deepEqual(writes[2].args.where, { accountId: ACCOUNT, id: { in: [4] } });
  assert.deepEqual(writes[3].args.where, { accountId: ACCOUNT, id: { in: [3] } });
  for (const w of writes) assert.equal(w.args.where?.accountId, ACCOUNT, w.op);
});

test("Teilscan (partial): Gesehenes wird geschrieben, Fehlende weder gezaehlt noch geloescht", async () => {
  const rows = [stored(1, "192.168.1.11"), stored(3, "192.168.1.13", { absentScans: 1 }), stored(4, "192.168.1.14")];
  const { db, writes } = fakeDb(rows);
  const res = await ingestHubScanDevices(db, ACCOUNT, [scanned(rows[0])], "hub", { partial: true });
  assert.equal(res.pruned, 0);
  assert.deepEqual(
    writes.map((w) => w.op),
    ["discoveredDevice.updateMany"]
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestSwitchSnapshots, switchesToIngest, type SwitchIngestPayload } from "./snmp-ingest";

/**
 * Datenbank-Attrappe: liefert zwei bekannte Switches mit je einem Port und
 * merkt sich jede Schreibung (Modell, Methode, Argumente).
 */
function fakeDb() {
  const writes: Array<{ model: string; op: string; args: unknown }> = [];
  const rec = (model: string, op: string) => (args: unknown) => {
    const w = { model, op, args };
    writes.push(w);
    return w;
  };
  const db = {
    networkDevice: {
      findMany: async () => [
        { id: 1, name: "sw-halle", ipAddress: "10.0.0.2", ports: [{ id: 11, number: 1, vlanId: null, uplink: false }] },
        { id: 2, name: "sw-tor", ipAddress: "10.0.0.3", ports: [{ id: 21, number: 1, vlanId: null, uplink: false }] },
      ],
      update: rec("networkDevice", "update"),
    },
    networkVlan: { findMany: async () => [{ id: 5, vlanId: 20 }] },
    networkClient: { findMany: async () => [], update: rec("networkClient", "update") },
    networkPort: { updateMany: rec("networkPort", "updateMany") },
    discoveredDevice: { findMany: async () => [], updateMany: rec("discoveredDevice", "updateMany") },
    $transaction: async (ops: unknown[]) => ops,
  };
  return { db: db as never, writes };
}

const ok: SwitchIngestPayload = {
  host: "10.0.0.2",
  sysName: "sw-halle",
  ports: [{ number: 1, up: true, pvid: 20 }],
  macTable: [{ mac: "00:11:22:33:44:55", port: 1, vlan: 20 }],
};

test("switchesToIngest: ausgefallene Switches (error) und Eintraege ohne Adresse fallen weg", () => {
  const list = switchesToIngest([
    ok,
    { host: "10.0.0.3", error: "keine SNMP-Antwort" },
    { host: "  " },
    { host: "10.0.0.4", error: "   " },
    null as never,
  ]);
  assert.deepEqual(
    list.map((x) => x.host),
    ["10.0.0.2", "10.0.0.4"]
  );
});

test("Abgleich: ein ausgefallener Switch gilt nicht als gesehen, an ihm wird nichts geschrieben", async () => {
  const { db, writes } = fakeDb();
  const stats = await ingestSwitchSnapshots(db, 1, [ok, { host: "10.0.0.3", error: "keine SNMP-Antwort" }]);
  assert.equal(stats.devices, 1);
  const deviceUpdates = writes.filter((w) => w.model === "networkDevice");
  assert.deepEqual(
    deviceUpdates.map((w) => (w.args as { where: { id: number } }).where.id),
    [1]
  );
  // Port 1 von sw-tor (id 21) bleibt unberuehrt, Port 1 von sw-halle bekommt sein VLAN.
  const portIds = writes
    .filter((w) => w.model === "networkPort")
    .flatMap((w) => (w.args as { where: { id: { in: number[] } } }).where.id.in);
  assert.deepEqual(portIds, [11]);
});

test("Abgleich: nur ausgefallene Switches schreiben gar nichts", async () => {
  const { db, writes } = fakeDb();
  const stats = await ingestSwitchSnapshots(db, 1, [{ host: "10.0.0.3", error: "keine SNMP-Antwort" }]);
  assert.deepEqual(stats, { devices: 0, ports: 0, clients: 0 });
  assert.equal(writes.length, 0);
});

test("Abgleich: Teilausfall ohne MAC-Tabelle schreibt Ports und lastSeenAt, aber keine Geraete-Zeitstempel", async () => {
  const { db, writes } = fakeDb();
  const partial = { ...ok, macTable: undefined, macs: 40, partial: ["fdb"] } as SwitchIngestPayload;
  await ingestSwitchSnapshots(db, 1, [partial]);
  assert.deepEqual(
    writes.map((w) => `${w.model}.${w.op}`),
    ["networkDevice.update", "networkPort.updateMany"]
  );
});

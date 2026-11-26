import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSnmpDetail, mergeHubStatus, snmpStatusSummary } from "./hub-status";

/** Switch, wie ihn der Hub hochlaedt (hub/src/snmp.ts): Ports und MAC-Tabelle als Listen. */
const uploaded = {
  host: "10.0.0.2",
  sysName: "sw-halle",
  sysDescr: "Switch 24 Port",
  uptimeS: 86_400,
  polledAt: "2026-11-25T10:00:00.000Z",
  ports: [
    { number: 1, descr: "Port 1", up: true, pvid: 1 },
    { number: 2, descr: "Port 2", up: false, pvid: 1 },
    { number: 3, descr: "Port 3", up: true, pvid: 20 },
  ],
  macTable: [
    { mac: "00:11:22:33:44:55", port: 1, vlan: 1 },
    { mac: "00:11:22:33:44:66", port: 3, vlan: 20 },
  ],
};

const summary = {
  host: "10.0.0.2",
  sysName: "sw-halle",
  polledAt: "2026-11-25T10:00:00.000Z",
  ports: 3,
  portsUp: 2,
  macs: 2,
  error: null,
};

const stats = { devices: 1, ports: 3, clients: 2 };

/** Status, wie ihn alle drei Schreiber zusammen hinterlassen. */
const full = () => ({
  system: { autoLogin: true, sleep: "never" },
  repoAccess: { ok: true },
  sentinel: { at: "2026-11-25T10:00:00.000Z", cameras: [3, 4] },
  sentinelMuted: { "4": 2 },
  parking: { at: "2026-11-25T10:00:00.000Z", trackerOnline: true, lots: [] },
  snmp: { at: "2026-11-25T10:00:00.000Z", stats, switches: [summary] },
});

test("snmpStatusSummary: je Switch Name, Abfragezeit, Ports, verbundene Ports, MACs, Fehler", () => {
  assert.deepEqual(snmpStatusSummary([uploaded]), [summary]);
  // Ohne Listen und Namen: Zahlen 0, Texte null, host leer.
  assert.deepEqual(snmpStatusSummary([{}]), [
    { host: "", sysName: null, polledAt: null, ports: 0, portsUp: 0, macs: 0, error: null },
  ]);
  assert.deepEqual(snmpStatusSummary([{ host: "10.0.0.3", error: "Zeitueberschreitung" }])[0].error, "Zeitueberschreitung");
});

test("snmpStatusSummary: schon gekuerzt bleibt gleich, Nicht-Objekte fallen weg", () => {
  assert.deepEqual(snmpStatusSummary([summary]), [summary]);
  assert.deepEqual(snmpStatusSummary(snmpStatusSummary([uploaded])), [summary]);
  assert.deepEqual(snmpStatusSummary([null, 3, "x", [uploaded], uploaded]), [summary]);
  assert.deepEqual(snmpStatusSummary(undefined), []);
  assert.deepEqual(snmpStatusSummary({ host: "10.0.0.2" }), []);
});

test("snmpStatusSummary: verbunden zaehlt nur up === true", () => {
  const ports = [{ up: true }, { up: "true" }, { up: 1 }, null, { up: false }, {}];
  assert.equal(snmpStatusSummary([{ host: "h", ports }])[0].portsUp, 1);
  assert.equal(snmpStatusSummary([{ host: "h", ports }])[0].ports, 6);
});

test("snmpStatusSummary: Kurzfassung ist klein (ohne Ports und MAC-Tabelle)", () => {
  const big = {
    ...uploaded,
    ports: Array.from({ length: 52 }, (_, i) => ({ number: i + 1, descr: `Port ${i + 1}`, up: i % 2 === 0, pvid: 1 })),
    macTable: Array.from({ length: 400 }, (_, i) => ({ mac: `00:11:22:33:${String(i % 100).padStart(2, "0")}:00`, port: 1, vlan: 1 })),
  };
  const before = JSON.stringify({ snmp: { switches: [big, big] } }).length;
  const after = JSON.stringify({ snmp: { switches: snmpStatusSummary([big, big]) } }).length;
  assert.ok(before > 40_000, String(before));
  assert.ok(after < 500, String(after));
  assert.deepEqual(snmpStatusSummary([big])[0], { ...summary, ports: 52, portsUp: 26, macs: 400 });
});

test("mergeHubStatus: jeder Schreiber ersetzt nur seinen Schluessel", () => {
  const writers: Array<[string, Record<string, unknown>]> = [
    ["Heartbeat", { system: { autoLogin: false }, repoAccess: { ok: false }, sentinel: { at: "spaeter", cameras: [] } }],
    ["Heartbeat eines aelteren Hubs", { parking: { at: "spaeter", trackerOnline: false, lots: [] }, system: { autoLogin: false } }],
    ["Parkmeldung", { parking: { at: "spaeter", trackerOnline: true, lots: [{ kioskId: "halle", count: 2 }] } }],
    ["Switch", { snmp: { at: "spaeter", stats, switches: [summary] } }],
  ];
  for (const [who, patch] of writers) {
    const before = full();
    const after = mergeHubStatus(before, patch);
    for (const key of Object.keys(before)) {
      const expected = key in patch ? patch[key] : before[key as keyof typeof before];
      assert.deepEqual(after[key], expected, `${who}: ${key}`);
    }
    assert.deepEqual(Object.keys(after).sort(), [...new Set([...Object.keys(before), ...Object.keys(patch)])].sort(), who);
    assert.deepEqual(before, full(), `${who}: Eingabe unveraendert`);
  }
});

test("mergeHubStatus: Altbestand mit Ports und MAC-Tabelle wird beim naechsten Schreiben gekuerzt", () => {
  const legacy = { ...full(), snmp: { at: "frueher", stats, switches: [uploaded, { host: "10.0.0.3", sysName: "sw-tor", ports: [], macTable: [] }] } };
  assert.equal(hasSnmpDetail(legacy), true);
  for (const patch of [{ parking: { at: "jetzt", trackerOnline: true, lots: [] } }, { system: { autoLogin: true } }]) {
    const after = mergeHubStatus(legacy, patch);
    assert.equal(hasSnmpDetail(after), false);
    assert.deepEqual(after.snmp, {
      at: "frueher",
      stats,
      switches: [summary, { host: "10.0.0.3", sysName: "sw-tor", polledAt: null, ports: 0, portsUp: 0, macs: 0, error: null }],
    });
    assert.deepEqual(after.sentinelMuted, legacy.sentinelMuted);
  }
  // Der Switch-Upload ersetzt snmp ohnehin; ein Patch mit Listen wird ebenfalls gekuerzt.
  assert.deepEqual(mergeHubStatus(legacy, { snmp: { at: "jetzt", stats, switches: [uploaded] } }).snmp, {
    at: "jetzt",
    stats,
    switches: [summary],
  });
});

test("mergeHubStatus: ohne Listen bleibt snmp, wie es ist (auch fremde Felder)", () => {
  const status = { snmp: { at: "x", stats, switches: [summary], note: "bleibt" } };
  assert.equal(hasSnmpDetail(status), false);
  const after = mergeHubStatus(status, { parking: { lots: [] } });
  assert.equal(after.snmp, status.snmp);
  assert.equal(hasSnmpDetail({ snmp: { switches: "kaputt" } }), false);
  assert.deepEqual(mergeHubStatus({ snmp: { switches: "kaputt" } }, {}), { snmp: { switches: "kaputt" } });
});

test("mergeHubStatus: leerer, fehlender oder kaputter Status wird zu einem neuen Objekt", () => {
  const patch = { parking: { lots: [] } };
  for (const existing of [null, undefined, {}, [], "text", 7, true, [{ parking: 1 }]]) {
    assert.deepEqual(mergeHubStatus(existing, patch), patch, JSON.stringify(existing) ?? "undefined");
  }
});

test("mergeHubStatus: undefined im Patch zaehlt nicht, null ersetzt", () => {
  const before = full();
  const after = mergeHubStatus(before, { parking: undefined, system: null });
  assert.deepEqual(after.parking, before.parking);
  assert.equal(after.system, null);
});

test("hasSnmpDetail: eine Port-Liste oder eine MAC-Tabelle allein ist schon Altbestand", () => {
  const macsOnly = { snmp: { switches: [{ host: "10.0.0.2", ports: 3, macTable: [{ mac: "00:11:22:33:44:55" }] }] } };
  const portsOnly = { snmp: { switches: [{ host: "10.0.0.2", ports: [{ up: true }], macs: 2 }] } };
  assert.equal(hasSnmpDetail(macsOnly), true);
  assert.equal(hasSnmpDetail(portsOnly), true);
  assert.deepEqual((mergeHubStatus(macsOnly, {}).snmp as { switches: unknown }).switches, [
    { host: "10.0.0.2", sysName: null, polledAt: null, ports: 3, portsUp: 0, macs: 1, error: null },
  ]);
  assert.deepEqual((mergeHubStatus(portsOnly, {}).snmp as { switches: unknown }).switches, [
    { host: "10.0.0.2", sysName: null, polledAt: null, ports: 1, portsUp: 1, macs: 2, error: null },
  ]);
  // Ohne Liste in irgendeinem Eintrag bleibt alles, wie es ist.
  assert.equal(hasSnmpDetail({ snmp: { switches: [summary, { host: "x", ports: 2, macs: 0 }] } }), false);
});

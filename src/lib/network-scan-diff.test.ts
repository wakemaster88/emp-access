import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABSENT_SCANS_BEFORE_PRUNE,
  RESPONSE_MS_TOLERANCE,
  absentPlan,
  pushIpHistory,
  sameResponseMs,
  scanDiff,
  type ScanSeen,
  type ScanStored,
} from "./network-scan-diff";

const now = new Date("2026-11-26T10:00:00.000Z");
const earlier = new Date("2026-11-26T09:30:00.000Z");

const seenOf = (o: Partial<ScanSeen> = {}): ScanSeen => ({
  ip: "192.168.1.20",
  iface: "en0",
  hostname: "drucker",
  vendor: "Beispiel GmbH",
  openPorts: [80, 443],
  deviceType: "printer",
  responseMs: 4,
  reachable: true,
  ...o,
});

const storedOf = (mac: string, o: Partial<ScanStored> = {}): ScanStored => ({
  macAddress: mac,
  ipAddress: "192.168.1.20",
  iface: "en0",
  hostname: "drucker",
  vendor: "Beispiel GmbH",
  openPorts: [80, 443],
  deviceType: "printer",
  responseMs: 4,
  reachable: true,
  absentScans: 0,
  hubName: "hub",
  ipHistory: null,
  lastSeenAt: earlier,
  ...o,
});

const A = "02:00:00:00:00:0A";
const B = "02:00:00:00:00:0B";
const C = "02:00:00:00:00:0C";

test("scanDiff: neu, geaendert, unveraendert", () => {
  const plan = scanDiff(
    [storedOf(A), storedOf(B)],
    new Map([
      [A, seenOf()],
      [B, seenOf({ openPorts: [80] })],
      [C, seenOf({ ip: "192.168.1.30" })],
    ]),
    now,
    "hub",
  );
  assert.deepEqual(plan.unchanged, [A]);
  assert.deepEqual(plan.changed.map((c) => c.mac), [B]);
  assert.deepEqual(plan.fresh.map((f) => f.mac), [C]);
  assert.deepEqual(plan.fresh[0].data, {
    ipAddress: "192.168.1.30",
    iface: "en0",
    hostname: "drucker",
    vendor: "Beispiel GmbH",
    openPorts: [80, 443],
    deviceType: "printer",
    responseMs: 4,
    reachable: true,
    absentScans: 0,
    hubName: "hub",
    lastSeenAt: now,
  });
});

test("scanDiff: Ping-Zeit erst ab mehr als 20 ms eine Aenderung", () => {
  const plan = (stored: number | null, seen: number | null) =>
    scanDiff([storedOf(A, { responseMs: stored })], new Map([[A, seenOf({ responseMs: seen })]]), now, "hub");
  assert.deepEqual(plan(4, 4 + RESPONSE_MS_TOLERANCE).unchanged, [A]);
  assert.deepEqual(plan(30, 10).unchanged, [A]);
  const far = plan(4, 25);
  assert.equal(far.changed.length, 1);
  assert.equal(far.changed[0].data.responseMs, 25);
  // Leer gegen Wert ist eine Aenderung, leer gegen leer nicht.
  assert.equal(plan(null, 3).changed[0].data.responseMs, 3);
  assert.equal(plan(3, null).changed[0].data.responseMs, null);
  assert.deepEqual(plan(null, null).unchanged, [A]);
  // Ein anderes Feld geaendert, Ping nah dran: Ping-Zeit bleibt die gespeicherte.
  const other = scanDiff([storedOf(A, { responseMs: 4 })], new Map([[A, seenOf({ hostname: "neu", responseMs: 9 })]]), now, "hub");
  assert.equal("responseMs" in other.changed[0].data, false);
  assert.equal(sameResponseMs(0, 20), true);
  assert.equal(sameResponseMs(0, 21), false);
});

test("scanDiff: jedes andere Feld zaehlt als Aenderung, auch Zaehler, Erreichbarkeit und Hub", () => {
  const cases: Array<[Partial<ScanStored>, Partial<ScanSeen>, string | null]> = [
    [{ ipAddress: "192.168.1.21" }, {}, "hub"],
    [{ ipAddress: null }, {}, "hub"],
    [{ iface: null }, {}, "hub"],
    [{ hostname: "alt" }, {}, "hub"],
    [{ vendor: null }, {}, "hub"],
    [{ openPorts: [443, 80] }, {}, "hub"],
    [{ openPorts: null }, {}, "hub"],
    [{ deviceType: "camera" }, {}, "hub"],
    [{ reachable: false }, {}, "hub"],
    [{ absentScans: 1 }, {}, "hub"],
    [{}, {}, "anderer-hub"],
  ];
  for (const [stored, seen, hub] of cases) {
    const plan = scanDiff([storedOf(A, stored)], new Map([[A, seenOf(seen)]]), now, hub);
    assert.equal(plan.changed.length, 1, JSON.stringify(stored));
  }
});

test("scanDiff: IP-Wechsel schreibt die alte IP in den Verlauf", () => {
  const plan = scanDiff(
    [storedOf(A, { ipAddress: "192.168.1.21", ipHistory: [{ ip: "192.168.1.5", seenUntil: "x" }] })],
    new Map([[A, seenOf()]]),
    now,
    "hub",
  );
  assert.deepEqual(plan.changed[0].data.ipHistory, [
    { ip: "192.168.1.21", seenUntil: earlier.toISOString() },
    { ip: "192.168.1.5", seenUntil: "x" },
  ]);
});

/* ---------------------------------------------- gegen die fruehere Logik */

type Row = Record<string, unknown> & { macAddress: string };

/** Fruehere Schreibung: je gesehenem Geraet alle Felder (Stand vor scanDiff). */
function oldApply(rows: Map<string, Row>, seen: Map<string, ScanSeen>, hubName: string | null): Map<string, Row> {
  const out = new Map([...rows].map(([k, v]) => [k, { ...v }]));
  for (const [mac, info] of seen) {
    const prev = out.get(mac) as (Row & ScanStored) | undefined;
    const ipChanged = !!prev && !!prev.ipAddress && !!info.ip && prev.ipAddress !== info.ip;
    const common = {
      ipAddress: info.ip,
      iface: info.iface,
      hostname: info.hostname,
      vendor: info.vendor,
      openPorts: info.openPorts,
      deviceType: info.deviceType,
      responseMs: info.responseMs,
      reachable: info.reachable,
      absentScans: 0,
      hubName,
      lastSeenAt: now,
      ...(ipChanged ? { ipHistory: pushIpHistory(prev.ipHistory, prev.ipAddress, prev.lastSeenAt) } : {}),
    };
    if (prev) out.set(mac, { ...prev, ...common });
    else out.set(mac, { macAddress: mac, firstSeenAt: now, ...common });
  }
  return out;
}

/** Neue Schreibung nach dem Plan. */
function newApply(rows: Map<string, Row>, seen: Map<string, ScanSeen>, hubName: string | null): Map<string, Row> {
  const out = new Map([...rows].map(([k, v]) => [k, { ...v }]));
  const plan = scanDiff([...rows.values()] as unknown as ScanStored[], seen, now, hubName);
  for (const f of plan.fresh) out.set(f.mac, { macAddress: f.mac, firstSeenAt: now, ...f.data });
  for (const c of plan.changed) out.set(c.mac, { ...out.get(c.mac)!, ...c.data });
  for (const mac of plan.unchanged) out.set(mac, { ...out.get(mac)!, lastSeenAt: now });
  return out;
}

/** Fester Zufall, damit der Test immer dieselben Faelle prueft. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("scanDiff gegen die fruehere Logik: gleiche Zeilen, nur die Ping-Zeit darf bis 20 ms abweichen", () => {
  const r = rng(42);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  for (let round = 0; round < 300; round++) {
    const rows = new Map<string, Row>();
    const seen = new Map<string, ScanSeen>();
    for (let i = 0; i < 12; i++) {
      const mac = `02:00:00:00:01:${i.toString(16).padStart(2, "0").toUpperCase()}`;
      const ip = pick([`192.168.1.${10 + i}`, `192.168.1.${40 + i}`, null]);
      if (r() < 0.8) {
        rows.set(mac, {
          ...storedOf(mac, {
            ipAddress: pick([ip, `192.168.1.${70 + i}`, null]),
            hostname: pick(["drucker", null]),
            openPorts: pick([[80, 443], [80], [], null]),
            responseMs: pick([null, 2, 15, 40]),
            reachable: pick([true, false]),
            absentScans: pick([0, 0, 1]),
            hubName: pick(["hub", "hub", "alt", null]),
            ipHistory: pick([null, [{ ip: "192.168.1.200", seenUntil: "x" }]]),
          }),
        } as Row);
      }
      if (r() < 0.85) {
        seen.set(
          mac,
          seenOf({
            ip,
            hostname: pick(["drucker", null]),
            openPorts: pick([[80, 443], [80], []]),
            responseMs: pick([null, 1, 3, 12, 30, 60]),
            reachable: pick([true, true, false]),
          }),
        );
      }
    }
    const hub = pick(["hub", "hub", "alt"]);
    const before = oldApply(rows, seen, hub);
    const after = newApply(rows, seen, hub);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
    for (const [mac, o] of before) {
      const n = after.get(mac)!;
      const { responseMs: ro, ...restO } = o as Row & { responseMs: number | null };
      const { responseMs: rn, ...restN } = n as Row & { responseMs: number | null };
      assert.deepEqual(restN, restO, `Runde ${round}, ${mac}`);
      assert.ok(sameResponseMs(rn ?? null, ro ?? null), `Ping ${rn} gegen ${ro}`);
    }
  }
});

test("absentPlan: wie frueher – unzugeordnete beim zweiten Fehlen loeschen, sonst Zaehler +1", () => {
  const missing = [
    { id: 1, macAddress: "02:00:00:00:00:01", ipAddress: null, absentScans: 0 },
    { id: 2, macAddress: "02:00:00:00:00:02", ipAddress: null, absentScans: 1 },
    { id: 3, macAddress: "02:00:00:00:00:03", ipAddress: null, absentScans: 5 },
    { id: 4, macAddress: "02:00:00:00:00:04", ipAddress: "192.168.1.9", absentScans: 3 },
    { id: 5, macAddress: "02:00:00:00:00:05", ipAddress: "192.168.1.8", absentScans: 1 },
  ];
  const plan = absentPlan(missing, new Set(["02:00:00:00:00:03"]), new Set(["192.168.1.9"]));
  assert.deepEqual(plan, { absent: [1, 3, 4], toDelete: [2, 5] });
  // Frueher: je neuem Zaehlerstand eine Schreibung; jetzt +1 in einer. Ergebnis gleich.
  for (const m of missing) {
    if (plan.toDelete.includes(m.id)) assert.ok(m.absentScans + 1 >= ABSENT_SCANS_BEFORE_PRUNE);
  }
});

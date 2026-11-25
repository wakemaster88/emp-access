import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviceActionOutcome,
  deviceActionRow,
  recordDeviceAction,
  type DeviceActionRow,
} from "./device-action-log";

const ENTRY = { accountId: 1, deviceId: 7, deviceName: "Eingang", action: "open", result: "ok" as const };

test("deviceActionRow: ohne Angabe ist die Quelle unbekannt", () => {
  const row = deviceActionRow(ENTRY);
  assert.deepEqual(row, {
    accountId: 1,
    deviceId: 7,
    deviceName: "Eingang",
    action: "open",
    result: "ok",
    source: "unbekannt",
    actorId: null,
    actorLabel: null,
  });
});

test("deviceActionRow: fehlender Name wird zu #<id>, Laengen begrenzt", () => {
  const row = deviceActionRow({
    ...ENTRY,
    deviceName: "  ",
    action: "x".repeat(100),
    by: { source: "mcp", actorLabel: "a".repeat(300) },
  });
  assert.equal(row.deviceName, "#7");
  assert.equal(row.action.length, 40);
  assert.equal(row.actorLabel?.length, 120);
  assert.equal(row.source, "mcp");
});

test("deviceActionRow: nur gueltige Admin-IDs", () => {
  assert.equal(deviceActionRow({ ...ENTRY, by: { source: "admin", actorId: 3 } }).actorId, 3);
  assert.equal(deviceActionRow({ ...ENTRY, by: { source: "admin", actorId: 0 } }).actorId, null);
  assert.equal(deviceActionRow({ ...ENTRY, by: { source: "admin", actorId: 1.5 } }).actorId, null);
  assert.equal(deviceActionRow({ ...ENTRY, by: { source: "admin", actorId: null } }).actorId, null);
});

test("deviceActionOutcome: Fehlertext oder fehlender Versand bei Fernbefehl ist fehler", () => {
  assert.equal(deviceActionOutcome(true, { sent: true }), "ok");
  assert.equal(deviceActionOutcome(true, { sent: false }), "fehler");
  // Pi holt den Auftrag selbst ab: sent ist dort immer falsch.
  assert.equal(deviceActionOutcome(false, { sent: false }), "ok");
  assert.equal(deviceActionOutcome(false, { sent: false, error: "x" }), "fehler");
  assert.equal(deviceActionOutcome(true, { sent: true, error: "x" }), "fehler");
});

test("recordDeviceAction: schreibt die Zeile und gibt die Promise an keep", async () => {
  const rows: DeviceActionRow[] = [];
  let kept: Promise<unknown> | null = null;
  recordDeviceAction(
    { ...ENTRY, by: { source: "kiosk", actorLabel: "monitor:2" } },
    async (row) => { rows.push(row); },
    (p) => { kept = p; },
  );
  assert.ok(kept);
  await kept;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "kiosk");
  assert.equal(rows[0].actorLabel, "monitor:2");
});

test("recordDeviceAction: wartet nicht auf das Schreiben", () => {
  let done = false;
  recordDeviceAction(ENTRY, () => new Promise(() => {}), () => {});
  done = true;
  assert.equal(done, true);
});

test("recordDeviceAction: wirft nie", async () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    let kept: Promise<unknown> | null = null;
    assert.doesNotThrow(() =>
      recordDeviceAction(ENTRY, () => Promise.reject(new Error("db weg")), (p) => { kept = p; }),
    );
    await kept; // abgefangen, keine unbehandelte Ablehnung
    assert.doesNotThrow(() =>
      recordDeviceAction(ENTRY, () => { throw new Error("sofort"); }, () => {}),
    );
    assert.doesNotThrow(() =>
      recordDeviceAction(ENTRY, async () => {}, () => { throw new Error("ausserhalb einer Anfrage"); }),
    );
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 2);
});

test("recordDeviceAction: after() ausserhalb einer Anfrage bricht nichts ab", async () => {
  let written = false;
  assert.doesNotThrow(() => recordDeviceAction(ENTRY, async () => { written = true; }));
  await new Promise((r) => setImmediate(r));
  assert.equal(written, true);
});

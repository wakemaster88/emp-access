import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { triggerDeviceAction } from "./device-open";

// triggerDeviceAction schreibt den Protokoll-Eintrag ueber
// prisma.deviceActionLog.create. Der Writer wird hier ersetzt, ohne Datenbank.
const delegate = prisma.deviceActionLog as unknown as { create: (args: unknown) => Promise<unknown> };

let events: string[] = [];
let rows: Array<Record<string, unknown>> = [];

function fakeDb(update: () => Promise<unknown> = async () => ({})) {
  return {
    device: {
      update: async () => {
        events.push("schalten");
        return update();
      },
    },
  } as unknown as Parameters<typeof triggerDeviceAction>[0];
}

const PI = { id: 5, name: "Drehkreuz", type: "RASPBERRY_PI", shellyId: null, ipAddress: null };
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  events = [];
  rows = [];
  delegate.create = async (args) => {
    events.push("protokoll");
    rows.push((args as { data: Record<string, unknown> }).data);
    return { id: 1 };
  };
});

test("triggerDeviceAction: Eintrag erst nach dem Schalten, Ergebnis unveraendert", async () => {
  const res = await triggerDeviceAction(fakeDb(), PI, 1, "open", {
    actor: { source: "kiosk", actorLabel: "monitor:3" },
  });
  await tick();
  assert.deepEqual(res, { task: 1, sent: false });
  assert.deepEqual(events, ["schalten", "protokoll"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deviceId, 5);
  assert.equal(rows[0].deviceName, "Drehkreuz");
  assert.equal(rows[0].action, "open");
  assert.equal(rows[0].result, "ok");
  assert.equal(rows[0].source, "kiosk");
  assert.equal(rows[0].actorLabel, "monitor:3");
});

test("triggerDeviceAction: ohne actor steht die Quelle unbekannt", async () => {
  await triggerDeviceAction(fakeDb(), PI, 1, "deactivate");
  await tick();
  assert.equal(rows[0].source, "unbekannt");
});

test("triggerDeviceAction: fehlschlagender Writer aendert das Ergebnis nicht", async () => {
  delegate.create = async () => {
    throw new Error("db weg");
  };
  const res = await triggerDeviceAction(fakeDb(), PI, 1, "open");
  await tick();
  assert.deepEqual(res, { task: 1, sent: false });
});

test("triggerDeviceAction: haengender Writer haelt die Schaltung nicht auf", async () => {
  delegate.create = () => new Promise(() => {});
  const started = Date.now();
  const res = await Promise.race([
    triggerDeviceAction(fakeDb(), PI, 1, "open"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("haengt")), 500)),
  ]);
  assert.deepEqual(res, { task: 1, sent: false });
  assert.ok(Date.now() - started < 500);
});

test("triggerDeviceAction: Ausnahme wird unveraendert weitergeworfen und als fehler protokolliert", async () => {
  const boom = new Error("update fehlgeschlagen");
  await assert.rejects(
    triggerDeviceAction(
      fakeDb(async () => {
        throw boom;
      }),
      PI,
      1,
      "open",
    ),
    (err) => err === boom,
  );
  await tick();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, "fehler");
});

test("triggerDeviceAction: Shelly ohne Versandweg wird als fehler protokolliert", async () => {
  const res = await triggerDeviceAction(fakeDb(), { id: 9, name: "Licht", type: "SHELLY", shellyId: null, ipAddress: null }, 1, "open");
  await tick();
  assert.equal(res.sent, false);
  assert.equal(rows[0].result, "fehler");
});

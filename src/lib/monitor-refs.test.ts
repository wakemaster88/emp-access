import { test } from "node:test";
import assert from "node:assert/strict";
import { addedMonitorIds, checkMonitorRefs, monitorIdList } from "./monitor-refs";
import type { TenantDb } from "./prisma";

test("monitorIdList: Zahlen und Ziffern-Strings, Reihenfolge bleibt, Duplikate fallen weg", () => {
  assert.deepEqual(monitorIdList([3, "1", 3, null, 0, -2, "x", 1.5]), [3, 1]);
  assert.deepEqual(monitorIdList([]), []);
  assert.equal(monitorIdList(undefined), undefined);
  assert.equal(monitorIdList("1,2"), undefined);
});

test("addedMonitorIds: nur neue IDs je Liste", () => {
  assert.deepEqual(
    addedMonitorIds(
      { deviceIds: [1, 2], areaIds: [5, 6], controlDeviceIds: [9] },
      { deviceIds: [1], areaIds: [6], controlDeviceIds: [] },
    ),
    { deviceIds: [2], areaIds: [5], controlDeviceIds: [9] },
  );
  const next = { deviceIds: [1], areaIds: [], controlDeviceIds: [] };
  assert.equal(addedMonitorIds(next), next);
});

/** Attrappe: eigene Geraete und Bereiche des Mandanten. */
function fakeDb(own: { device?: number[]; accessArea?: number[] }) {
  const calls: Array<{ model: string; where: unknown }> = [];
  const table = (model: "device" | "accessArea") => ({
    findMany: async ({ where }: { where: { id: { in: number[] } } }) => {
      calls.push({ model, where });
      return (own[model] ?? []).filter((id) => where.id.in.includes(id)).map((id) => ({ id }));
    },
  });
  const db = { device: table("device"), accessArea: table("accessArea") } as unknown as TenantDb;
  return { db, calls };
}

/** Fehlertext oder null. */
async function refError(...args: Parameters<typeof checkMonitorRefs>): Promise<string | null> {
  const r = await checkMonitorRefs(...args);
  return "error" in r ? r.error : null;
}

/** Zu speichernde deviceIds (Fehler wirft). */
async function savedDeviceIds(...args: Parameters<typeof checkMonitorRefs>): Promise<number[]> {
  const r = await checkMonitorRefs(...args);
  if ("error" in r) throw new Error(r.error);
  return r.lists.deviceIds;
}

test("checkMonitorRefs: eigene Geraete und Bereiche sind in Ordnung", async () => {
  const { db } = fakeDb({ device: [1, 9], accessArea: [5] });
  assert.equal(await refError(db, 7, "MONITOR", { deviceIds: [1], areaIds: [5], controlDeviceIds: [9] }), null);
  assert.equal(await refError(db, 7, "RESOURCE_MONITOR", { deviceIds: [5], areaIds: [], controlDeviceIds: [] }), null);
});

test("checkMonitorRefs: deviceIds wird nach dem Ziel-Typ geprueft, die andere Art faellt still weg", async () => {
  const { db } = fakeDb({ device: [1], accessArea: [5] });
  const lists = { deviceIds: [5, 1], areaIds: [], controlDeviceIds: [] };
  assert.deepEqual(await savedDeviceIds(db, 7, "CHECKIN", lists), [1]);
  assert.deepEqual(await savedDeviceIds(db, 7, "RESOURCE_MONITOR", lists), [5]);
});

test("checkMonitorRefs: eigener Bereich mit derselben ID wie ein fremdes Geraet gilt nicht als Geraet", async () => {
  // Bereich 12 gehoert dem Mandanten, Geraet 12 nicht.
  const { db } = fakeDb({ device: [], accessArea: [12] });
  for (const type of ["CHECKIN", "MONITOR", "SCANNER", "VOUCHER"]) {
    assert.deepEqual(await savedDeviceIds(db, 7, type, { deviceIds: [12], areaIds: [], controlDeviceIds: [] }), []);
  }
});

test("checkMonitorRefs: Typwechsel prueft die ganze deviceIds-Liste", async () => {
  const { db } = fakeDb({ device: [3], accessArea: [12] });
  const before = { deviceIds: [12, 3], areaIds: [], controlDeviceIds: [] };
  // Ohne Typwechsel bleiben gespeicherte IDs ungeprueft stehen.
  assert.deepEqual(await savedDeviceIds(db, 7, "RESOURCE_MONITOR", before, before), [12, 3]);
  // Ressourcen-Monitor -> Check-in: Bereich 12 ist kein Geraet und faellt weg.
  assert.deepEqual(await savedDeviceIds(db, 7, "CHECKIN", before, before, true), [3]);
  // Check-in -> Ressourcen-Monitor: nur der Bereich bleibt.
  assert.deepEqual(await savedDeviceIds(db, 7, "RESOURCE_MONITOR", before, before, true), [12]);
});

test("checkMonitorRefs: fremde IDs werden gemeldet", async () => {
  const { db } = fakeDb({ device: [1], accessArea: [5] });
  assert.match(
    (await refError(db, 7, "CHECKIN", { deviceIds: [42], areaIds: [], controlDeviceIds: [] })) ?? "",
    /Gerät nicht gefunden.*42/,
  );
  assert.match(
    (await refError(db, 7, "RESOURCE_MONITOR", { deviceIds: [42], areaIds: [], controlDeviceIds: [] })) ?? "",
    /Bereich nicht gefunden.*42/,
  );
  assert.match(
    (await refError(db, 7, "MONITOR", { deviceIds: [], areaIds: [43], controlDeviceIds: [] })) ?? "",
    /Bereich nicht gefunden.*43/,
  );
  assert.match(
    (await refError(db, 7, "MONITOR", { deviceIds: [], areaIds: [], controlDeviceIds: [5] })) ?? "",
    /Gerät nicht gefunden.*5/,
  );
});

test("checkMonitorRefs: schon gespeicherte IDs werden ohne Typwechsel nicht erneut geprueft", async () => {
  const { db, calls } = fakeDb({});
  const before = { deviceIds: [77], areaIds: [78], controlDeviceIds: [79] };
  assert.equal(await refError(db, 7, "MONITOR", before, before), null);
  assert.equal(calls.length, 0);
});

test("checkMonitorRefs: Abfragen tragen den accountId-Filter", async () => {
  const { db, calls } = fakeDb({ device: [1], accessArea: [] });
  await checkMonitorRefs(db, 7, "CHECKIN", { deviceIds: [1, 2], areaIds: [], controlDeviceIds: [] });
  assert.ok(calls.length > 0);
  for (const c of calls) assert.equal((c.where as { accountId?: number }).accountId, 7);
});

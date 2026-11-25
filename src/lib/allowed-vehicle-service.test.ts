import assert from "node:assert/strict";
import { test } from "node:test";
import { createAllowedVehicle, hubApprovalInput } from "./allowed-vehicle-service";
import type { TenantDb } from "./prisma";

type Cam = { id: number; accountId: number; kind: string };

/** Datenbank-Attrappe: Kameras zweier Konten, angelegte Fahrzeuge landen in `created`. */
function fakeDb(cameras: Cam[]) {
  const created: Array<Record<string, unknown>> = [];
  const db = {
    camera: {
      async findFirst(args: { where: { id: number; accountId: number; kind?: string } }) {
        const w = args.where;
        return cameras.find((c) => c.id === w.id && c.accountId === w.accountId && (!w.kind || c.kind === w.kind)) ?? null;
      },
    },
    device: { async findFirst() { return null; } },
    allowedVehicle: {
      async findUnique() { return null; },
      async create(args: { data: Record<string, unknown> }) {
        created.push(args.data);
        return { id: created.length, ...args.data };
      },
    },
  };
  return { db: db as unknown as TenantDb, created };
}

const CAMERAS: Cam[] = [
  { id: 11, accountId: 1, kind: "DOORBIRD" },
  { id: 9, accountId: 1, kind: "REOLINK" },
  { id: 21, accountId: 2, kind: "DOORBIRD" },
];

test("Genehmigung vom Hub: DoorBird des Kontos wird zugewiesen", async () => {
  const { db, created } = fakeDb(CAMERAS);
  const r = await createAllowedVehicle(db, 1, hubApprovalInput({ plate: "GT-AB 4321", cameraId: 9, doorbirdCameraId: 11 }));
  assert.equal(r.status, 201);
  assert.equal(created.length, 1);
  assert.equal(created[0].doorbirdCameraId, 11);
  assert.equal(created[0].cameraId, 9);
  assert.equal(created[0].plateNormalized, "GTAB4321");
});

test("Genehmigung vom Hub: fremde, unbekannte oder keine DoorBird-ID wird abgelehnt", async () => {
  for (const doorbirdCameraId of [21, 99, 9]) {
    const { db, created } = fakeDb(CAMERAS);
    const r = await createAllowedVehicle(db, 1, hubApprovalInput({ plate: "GT-AB 4321", doorbirdCameraId }));
    assert.equal(r.status, 400, String(doorbirdCameraId));
    assert.deepEqual(r.body, { error: "DoorBird nicht gefunden" });
    assert.equal(created.length, 0);
  }
});

test("Genehmigung vom Hub: ungültige DoorBird-ID wird abgelehnt statt ohne DoorBird angelegt", async () => {
  for (const doorbirdCameraId of ["abc", 1.5, -3, 0]) {
    const { db, created } = fakeDb(CAMERAS);
    const r = await createAllowedVehicle(db, 1, hubApprovalInput({ plate: "GT-AB 4321", doorbirdCameraId }));
    assert.equal(r.status, 400, String(doorbirdCameraId));
    assert.equal(created.length, 0);
  }
});

test("Genehmigung vom Hub ohne DoorBird-ID: wie bisher ohne Türöffnung", async () => {
  for (const body of [{ plate: "GT-AB 4321" }, { plate: "GT-AB 4321", doorbirdCameraId: null }]) {
    const { db, created } = fakeDb(CAMERAS);
    const r = await createAllowedVehicle(db, 1, hubApprovalInput(body));
    assert.equal(r.status, 201);
    assert.equal(created[0].doorbirdCameraId, null);
  }
});

test("hubApprovalInput: übernimmt nur bekannte Felder, Standardtexte wie bisher", () => {
  assert.deepEqual(hubApprovalInput({ plate: " GT-AB 4321 ", cameraId: 9, shellyDeviceId: 5, isActive: false }), {
    plate: "GT-AB 4321",
    name: "Genehmigt GT-AB 4321",
    notes: "Per Telegram vom Hub-Assistenten genehmigt.",
    cameraId: 9,
  });
  assert.deepEqual(hubApprovalInput({ plate: "GT-AB 4321", doorbirdCameraId: 11 }).doorbirdCameraId, 11);
  assert.equal(hubApprovalInput({ plate: "GT-AB 4321", cameraId: "9" }).cameraId, undefined);
  assert.equal(hubApprovalInput(null).plate, "");
});

import type { TenantDb } from "@/lib/prisma";
import { allowedVehicleCreateSchema, allowedVehicleUpdateSchema } from "@/lib/validators";
import { formatPlateDisplay, normalizePlate } from "@/lib/vehicles";

/**
 * Freigegebene Fahrzeuge anlegen, aendern, loeschen. Gemeinsam fuer die
 * Web-UI (/api/vehicles, Session) und das Hub-Dashboard (/api/hub/vehicles,
 * Token). Ergebnis ist immer { status, body } fuer NextResponse.json.
 */

export type ServiceResult = { status: number; body: unknown };

export const VEHICLE_INCLUDE = {
  shellyDevice: { select: { id: true, name: true } },
  camera: { select: { id: true, name: true } },
  doorbird: { select: { id: true, name: true } },
  _count: { select: { sightings: true } },
} as const;

async function checkRefs(
  db: TenantDb,
  accountId: number,
  data: { shellyDeviceId?: number | null; cameraId?: number | null; doorbirdCameraId?: number | null }
): Promise<string | null> {
  if (data.shellyDeviceId) {
    const device = await db.device.findFirst({
      where: { id: data.shellyDeviceId, accountId, type: "SHELLY" },
      select: { id: true },
    });
    if (!device) return "Shelly nicht gefunden";
  }
  if (data.cameraId) {
    const camera = await db.camera.findFirst({
      where: { id: data.cameraId, accountId },
      select: { id: true },
    });
    if (!camera) return "Kamera nicht gefunden";
  }
  if (data.doorbirdCameraId) {
    const doorbird = await db.camera.findFirst({
      where: { id: data.doorbirdCameraId, accountId, kind: "DOORBIRD" },
      select: { id: true },
    });
    if (!doorbird) return "DoorBird nicht gefunden";
  }
  return null;
}

export async function listAllowedVehicles(db: TenantDb, accountId: number) {
  return db.allowedVehicle.findMany({
    where: { accountId },
    include: VEHICLE_INCLUDE,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function createAllowedVehicle(
  db: TenantDb,
  accountId: number,
  body: unknown
): Promise<ServiceResult> {
  const parsed = allowedVehicleCreateSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.flatten() } };

  const plate = formatPlateDisplay(parsed.data.plate);
  const plateNormalized = normalizePlate(plate);
  if (plateNormalized.length < 2) return { status: 400, body: { error: "Ungültiges Kennzeichen" } };

  const refError = await checkRefs(db, accountId, parsed.data);
  if (refError) return { status: 400, body: { error: refError } };

  const existing = await db.allowedVehicle.findUnique({
    where: { accountId_plateNormalized: { accountId, plateNormalized } },
  });
  if (existing) {
    return { status: 400, body: { error: "Ein Fahrzeug mit diesem Kennzeichen existiert bereits" } };
  }

  const vehicle = await db.allowedVehicle.create({
    data: {
      accountId,
      name: parsed.data.name.trim(),
      plate,
      plateNormalized,
      isActive: parsed.data.isActive ?? true,
      notes: parsed.data.notes?.trim() || null,
      cameraId: parsed.data.cameraId ?? null,
      doorbirdCameraId: parsed.data.doorbirdCameraId ?? null,
      shellyDeviceId: parsed.data.shellyDeviceId ?? null,
      shellyAction: parsed.data.shellyAction ?? "ON",
      timerSeconds: parsed.data.timerSeconds ?? null,
      cooldownMinutes: parsed.data.cooldownMinutes ?? 2,
      notifyOnDetection: parsed.data.notifyOnDetection ?? false,
    },
    include: VEHICLE_INCLUDE,
  });
  return { status: 201, body: vehicle };
}

export async function updateAllowedVehicle(
  db: TenantDb,
  accountId: number,
  id: number,
  body: unknown
): Promise<ServiceResult> {
  const existing = await db.allowedVehicle.findFirst({ where: { id, accountId } });
  if (!existing) return { status: 404, body: { error: "Nicht gefunden" } };

  const parsed = allowedVehicleUpdateSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.flatten() } };

  const refError = await checkRefs(db, accountId, parsed.data);
  if (refError) return { status: 400, body: { error: refError } };

  let plate = existing.plate;
  let plateNormalized = existing.plateNormalized;
  if (parsed.data.plate !== undefined) {
    plate = formatPlateDisplay(parsed.data.plate);
    plateNormalized = normalizePlate(plate);
    if (plateNormalized.length < 2) return { status: 400, body: { error: "Ungültiges Kennzeichen" } };
    const clash = await db.allowedVehicle.findFirst({
      where: { accountId, plateNormalized, NOT: { id: existing.id } },
    });
    if (clash) {
      return { status: 400, body: { error: "Ein Fahrzeug mit diesem Kennzeichen existiert bereits" } };
    }
  }

  const d = parsed.data;
  const updated = await db.allowedVehicle.update({
    where: { id: existing.id },
    data: {
      ...(d.name !== undefined ? { name: d.name.trim() } : {}),
      ...(d.plate !== undefined ? { plate, plateNormalized } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
      ...(d.cameraId !== undefined ? { cameraId: d.cameraId } : {}),
      ...(d.doorbirdCameraId !== undefined ? { doorbirdCameraId: d.doorbirdCameraId } : {}),
      ...(d.shellyDeviceId !== undefined ? { shellyDeviceId: d.shellyDeviceId } : {}),
      ...(d.shellyAction !== undefined ? { shellyAction: d.shellyAction } : {}),
      ...(d.timerSeconds !== undefined ? { timerSeconds: d.timerSeconds } : {}),
      ...(d.cooldownMinutes !== undefined ? { cooldownMinutes: d.cooldownMinutes } : {}),
      ...(d.notifyOnDetection !== undefined ? { notifyOnDetection: d.notifyOnDetection } : {}),
    },
    include: VEHICLE_INCLUDE,
  });
  return { status: 200, body: updated };
}

export async function deleteAllowedVehicle(
  db: TenantDb,
  accountId: number,
  id: number
): Promise<ServiceResult> {
  const res = await db.allowedVehicle.deleteMany({ where: { id, accountId } });
  if (res.count === 0) return { status: 404, body: { error: "Nicht gefunden" } };
  return { status: 200, body: { success: true } };
}

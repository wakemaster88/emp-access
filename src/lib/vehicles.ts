import { prisma } from "@/lib/prisma";
import { controlShelly } from "@/lib/shelly";
import { sendPushToAccount } from "@/lib/web-push";

const SHELLY_ACTIONS = ["ON", "OFF", "TOGGLE"] as const;

/** Kennzeichen normalisieren: Grossbuchstaben, ohne Leerzeichen/Bindestriche/Punkte. */
export function normalizePlate(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .replace(/[Ä]/g, "AE")
    .replace(/[Ö]/g, "OE")
    .replace(/[Ü]/g, "UE")
    .replace(/ß/g, "SS")
    .replace(/[^A-Z0-9]/g, "");
}

export function formatPlateDisplay(plate: string): string {
  return plate.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Verarbeitet eine Fahrzeug-Sichtung: Historie anlegen, bei bekanntem
 * Kennzeichen gegen die Whitelist pruefen und ggf. Shelly/Push.
 */
export async function processVehicleSighting(opts: {
  accountId: number;
  cameraId?: number | null;
  plate?: string | null;
  source?: "CAMERA_VEHICLE" | "CAMERA_PLATE" | "MANUAL";
  seenAt?: Date;
  snapshot?: Buffer | null;
}): Promise<{
  sightingId: number;
  matched: boolean;
  shellyTriggered: boolean;
  shellyOk: boolean | null;
  vehicleName: string | null;
}> {
  const seenAt = opts.seenAt ?? new Date();
  const plateRaw = opts.plate?.trim() ? formatPlateDisplay(opts.plate) : null;
  const plateNormalized = plateRaw ? normalizePlate(plateRaw) : null;
  const source =
    opts.source ??
    (plateNormalized ? "CAMERA_PLATE" : "CAMERA_VEHICLE");
  const snapshot =
    opts.snapshot?.length ? new Uint8Array(opts.snapshot) : null;

  let vehicle =
    plateNormalized
      ? await prisma.allowedVehicle.findUnique({
          where: {
            accountId_plateNormalized: {
              accountId: opts.accountId,
              plateNormalized,
            },
          },
          include: { shellyDevice: true },
        })
      : null;

  if (vehicle && !vehicle.isActive) vehicle = null;

  const cameraAllowed =
    !vehicle ||
    vehicle.cameraId == null ||
    source === "MANUAL" ||
    (opts.cameraId != null && opts.cameraId === vehicle.cameraId);

  let shellyTriggered = false;
  let shellyOk: boolean | null = null;

  if (vehicle?.shellyDeviceId && vehicle.shellyDevice && cameraAllowed) {
    const cooldownMs = Math.max(1, vehicle.cooldownMinutes) * 60_000;
    const cooledDown =
      !vehicle.lastTriggeredAt ||
      seenAt.getTime() - vehicle.lastTriggeredAt.getTime() >= cooldownMs;

    if (cooledDown) {
      const action = (SHELLY_ACTIONS.includes(vehicle.shellyAction as (typeof SHELLY_ACTIONS)[number])
        ? vehicle.shellyAction
        : "ON"
      ).toLowerCase() as "on" | "off" | "toggle";

      const cloud = await prisma.apiConfig.findFirst({
        where: { accountId: opts.accountId, provider: "SHELLY" },
        select: { baseUrl: true },
      });

      shellyTriggered = true;
      shellyOk = await controlShelly(
        {
          ipAddress: vehicle.shellyDevice.ipAddress,
          shellyId: vehicle.shellyDevice.shellyId,
          shellyAuthKey: vehicle.shellyDevice.shellyAuthKey,
          cloudServer: cloud?.baseUrl ?? undefined,
        },
        action,
        vehicle.timerSeconds ?? undefined
      );

      await prisma.allowedVehicle.update({
        where: { id: vehicle.id },
        data: { lastTriggeredAt: seenAt },
      });
    }
  }

  if (vehicle?.notifyOnDetection) {
    const cam = opts.cameraId
      ? await prisma.camera.findFirst({
          where: { id: opts.cameraId, accountId: opts.accountId },
          select: { name: true },
        })
      : null;
    sendPushToAccount(opts.accountId, {
      title: `Fahrzeug erkannt: ${vehicle.name}`,
      body: `${plateRaw ?? "ohne Kennzeichen"} · ${cam?.name ?? "Kamera"}`,
      url: "/fahrzeuge",
      tag: `vehicle-match-${vehicle.id}`,
    }).catch((err) => console.error("[vehicles] push failed:", err));
  }

  const sighting = await prisma.vehicleSighting.create({
    data: {
      accountId: opts.accountId,
      cameraId: opts.cameraId ?? null,
      plate: plateRaw,
      plateNormalized,
      allowedVehicleId: vehicle?.id ?? null,
      source,
      matched: !!vehicle,
      shellyTriggered,
      shellyOk,
      seenAt,
      ...(snapshot ? { snapshot } : {}),
    },
  });

  return {
    sightingId: sighting.id,
    matched: !!vehicle,
    shellyTriggered,
    shellyOk,
    vehicleName: vehicle?.name ?? null,
  };
}

/** Bestehende Sichtung einem Whitelist-Fahrzeug zuordnen (Plate und/oder ID). */
export async function assignVehicleToSighting(opts: {
  accountId: number;
  sightingId: number;
  allowedVehicleId?: number | null;
  plate?: string | null;
  createVehicle?: { name: string; plate: string } | null;
}): Promise<{
  id: number;
  allowedVehicleId: number | null;
  plate: string | null;
  matched: boolean;
}> {
  const sighting = await prisma.vehicleSighting.findFirst({
    where: { id: opts.sightingId, accountId: opts.accountId },
    select: { id: true, cameraId: true },
  });
  if (!sighting) throw new Error("Sichtung nicht gefunden");

  let vehicleId = opts.allowedVehicleId ?? null;
  let plateRaw =
    opts.plate?.trim() ? formatPlateDisplay(opts.plate) : null;

  if (opts.createVehicle) {
    const plate = formatPlateDisplay(opts.createVehicle.plate);
    const plateNormalized = normalizePlate(plate);
    if (plateNormalized.length < 2) throw new Error("Ungültiges Kennzeichen");
    const created = await prisma.allowedVehicle.create({
      data: {
        accountId: opts.accountId,
        name: opts.createVehicle.name.trim() || plate,
        plate,
        plateNormalized,
        cameraId: null,
        notifyOnDetection: false,
      },
      select: { id: true, plate: true },
    });
    vehicleId = created.id;
    plateRaw = created.plate;
  } else if (vehicleId) {
    const v = await prisma.allowedVehicle.findFirst({
      where: { id: vehicleId, accountId: opts.accountId },
      select: { id: true, plate: true },
    });
    if (!v) throw new Error("Fahrzeug nicht gefunden");
    if (!plateRaw) plateRaw = v.plate;
  }

  const plateNormalized = plateRaw ? normalizePlate(plateRaw) : null;

  // Falls nur Plate gesetzt: Whitelist-Match versuchen.
  if (!vehicleId && plateNormalized) {
    const match = await prisma.allowedVehicle.findUnique({
      where: {
        accountId_plateNormalized: {
          accountId: opts.accountId,
          plateNormalized,
        },
      },
      select: { id: true },
    });
    if (match) vehicleId = match.id;
  }

  const updated = await prisma.vehicleSighting.update({
    where: { id: sighting.id },
    data: {
      plate: plateRaw,
      plateNormalized,
      allowedVehicleId: vehicleId,
      matched: !!vehicleId,
      source: plateNormalized ? "MANUAL" : "CAMERA_VEHICLE",
    },
    select: {
      id: true,
      allowedVehicleId: true,
      plate: true,
      matched: true,
    },
  });

  return updated;
}

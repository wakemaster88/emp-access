import { prisma } from "@/lib/prisma";
import { controlShelly } from "@/lib/shelly";

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
 * Kennzeichen gegen die Whitelist pruefen und ggf. Shelly schalten.
 */
export async function processVehicleSighting(opts: {
  accountId: number;
  cameraId?: number | null;
  plate?: string | null;
  source?: "CAMERA_VEHICLE" | "CAMERA_PLATE" | "MANUAL";
  seenAt?: Date;
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

  // Kamera-Einschraenkung: Shelly nur, wenn keine Kamera gesetzt ist,
  // die Sichtung von genau dieser Kamera kommt, oder manuell getestet wird.
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

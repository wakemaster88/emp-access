import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/**
 * GET (Hub): aktive Fahrzeuge inkl. Aktoren, damit Erkennung und Schaltung
 * lokal (auch offline) laufen. Verwaltung bleibt in der Cloud-UI.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const rows = await db.allowedVehicle.findMany({
    where: { accountId: account.id, isActive: true },
    select: {
      id: true,
      name: true,
      plate: true,
      plateNormalized: true,
      cameraId: true,
      doorbirdCameraId: true,
      cooldownMinutes: true,
      lastTriggeredAt: true,
      shellyAction: true,
      timerSeconds: true,
      shellyDevice: {
        select: { ipAddress: true },
      },
    },
    orderBy: { id: "asc" },
  });

  return NextResponse.json({
    localActuators: true,
    vehicles: rows.map((v) => ({
      id: v.id,
      name: v.name,
      plate: v.plate,
      plateNormalized: v.plateNormalized,
      cameraId: v.cameraId,
      doorbirdCameraId: v.doorbirdCameraId,
      cooldownMinutes: v.cooldownMinutes,
      lastTriggeredAt: v.lastTriggeredAt?.toISOString() ?? null,
      shellyAction: v.shellyAction,
      timerSeconds: v.timerSeconds,
      shellyIp: v.shellyDevice?.ipAddress ?? null,
    })),
  });
}

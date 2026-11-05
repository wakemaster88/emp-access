import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { createAllowedVehicle } from "@/lib/allowed-vehicle-service";

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

/**
 * POST (Hub): Fahrzeug auf die genehmigte Liste setzen – der Hub-Assistent
 * fragt per Telegram, wenn ein unbekanntes Kennzeichen mehrfach da war, und
 * legt es nach „Genehmigen“ an, beschraenkt auf die Kamera, an der es gesehen
 * wurde. Shelly/DoorBird-Zuordnung bleibt der Fahrzeugverwaltung in der Cloud.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;
  const body = (await request.json().catch(() => ({}))) as {
    plate?: unknown;
    name?: unknown;
    notes?: unknown;
    cameraId?: unknown;
  };
  const plate = typeof body.plate === "string" ? body.plate.trim() : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : `Genehmigt ${plate}`;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : "Per Telegram vom Hub-Assistenten genehmigt.";
  const cameraId = typeof body.cameraId === "number" && Number.isInteger(body.cameraId) ? body.cameraId : undefined;
  const r = await createAllowedVehicle(db, account.id, { plate, name, notes, cameraId });
  return NextResponse.json(r.body, { status: r.status });
}

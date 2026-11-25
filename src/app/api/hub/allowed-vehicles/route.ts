import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { createAllowedVehicle, hubApprovalInput } from "@/lib/allowed-vehicle-service";

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
        select: { ipAddress: true, shellyId: true, shellyAuthKey: true },
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
      // Shelly zugewiesen, den die Cloud schalten kann (IP-Adresse oder
      // Shelly-Cloud-Daten): Der Hub meldet ihn nicht als fehlenden Aktor.
      // Die Zugangsdaten bleiben auf dem Server, die Antwort trägt nur ja/nein.
      shellyLinked:
        v.shellyDevice != null &&
        (!!v.shellyDevice.ipAddress || (!!v.shellyDevice.shellyId && !!v.shellyDevice.shellyAuthKey)),
    })),
  });
}

/**
 * POST (Hub): Fahrzeug auf die genehmigte Liste setzen – der Hub-Assistent
 * fragt per Telegram, wenn ein unbekanntes Kennzeichen mehrfach da war, und
 * legt es nach „Genehmigen“ an, beschraenkt auf die Kamera, an der es gesehen
 * wurde. Ist genau eine DoorBird eingerichtet, schickt der Hub ihre ID mit
 * (doorbirdCameraId); sie muss zum Konto gehoeren und eine DoorBird sein
 * (checkRefs), sonst wird abgelehnt. Die Shelly-Zuordnung bleibt der
 * Fahrzeugverwaltung in der Cloud.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;
  const body = await request.json().catch(() => ({}));
  const r = await createAllowedVehicle(db, account.id, hubApprovalInput(body));
  return NextResponse.json(r.body, { status: r.status });
}

import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/**
 * GET (Hub, Token-Auth): Kamera-Konfiguration inklusive Zugangsdaten fuer
 * das lokale Kamera-Modul (Event-Polling + Schnappschuesse).
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const cameras = await db.camera.findMany({
    where: { accountId: account.id, enabled: true },
    select: {
      id: true,
      name: true,
      kind: true,
      host: true,
      macAddress: true,
      httpPort: true,
      https: true,
      username: true,
      password: true,
      channel: true,
      vehicleDetection: true,
      // Fallback-Regeln fuer „Fahrzeug ohne Kennzeichen“ (vision.ts am Hub).
      vehicleMinArea: true,
      vehicleZone: true,
    },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(cameras);
}

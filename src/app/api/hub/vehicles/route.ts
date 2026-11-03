import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { createAllowedVehicle, listAllowedVehicles } from "@/lib/allowed-vehicle-service";

/**
 * Fahrzeug-Verwaltung aus dem lokalen Hub-Dashboard (Token-Auth).
 * GET: alle Fahrzeuge (auch inaktive) plus Auswahllisten fuer das Formular.
 * POST: Fahrzeug anlegen (gleiche Regeln wie /api/vehicles).
 * Die reine Erkennungs-Whitelist bleibt GET /api/hub/allowed-vehicles.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const [vehicles, cameras, shellys] = await Promise.all([
    listAllowedVehicles(db, account.id),
    db.camera.findMany({
      where: { accountId: account.id, enabled: true },
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
    }),
    db.device.findMany({
      where: { accountId: account.id, type: "SHELLY" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({ vehicles, cameras, shellys });
}

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;
  const body = await request.json().catch(() => ({}));
  const r = await createAllowedVehicle(db, account.id, body);
  return NextResponse.json(r.body, { status: r.status });
}

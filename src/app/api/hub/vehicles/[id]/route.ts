import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { deleteAllowedVehicle, updateAllowedVehicle } from "@/lib/allowed-vehicle-service";

/** PUT/DELETE eines Fahrzeugs aus dem lokalen Hub-Dashboard (Token-Auth). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;
  const { id } = await params;
  const vehicleId = Number(id);
  if (!Number.isInteger(vehicleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const r = await updateAllowedVehicle(db, account.id, vehicleId, body);
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;
  const { id } = await params;
  const vehicleId = Number(id);
  if (!Number.isInteger(vehicleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await deleteAllowedVehicle(db, account.id, vehicleId);
  return NextResponse.json(r.body, { status: r.status });
}

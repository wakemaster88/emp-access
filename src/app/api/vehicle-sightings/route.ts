import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { vehicleSightingCreateSchema } from "@/lib/validators";
import { processVehicleSighting } from "@/lib/vehicles";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const vehicleId = request.nextUrl.searchParams.get("vehicleId");
  const take = Math.min(Number(request.nextUrl.searchParams.get("take") ?? 100) || 100, 500);

  // Explizites select ohne `snapshot`: die Bytes (bis ~1 MB pro Sichtung)
  // gehoeren nicht in die JSON-Liste – Bilder laufen ueber /[id]/snapshot.
  const sightings = await db.vehicleSighting.findMany({
    where: {
      accountId: accountId!,
      ...(vehicleId ? { allowedVehicleId: Number(vehicleId) } : {}),
    },
    select: {
      id: true,
      accountId: true,
      plate: true,
      plateNormalized: true,
      allowedVehicleId: true,
      source: true,
      matched: true,
      shellyTriggered: true,
      shellyOk: true,
      seenAt: true,
      createdAt: true,
      cameraId: true,
      camera: { select: { id: true, name: true } },
      allowedVehicle: { select: { id: true, name: true, plate: true } },
    },
    orderBy: { seenAt: "desc" },
    take,
  });
  return NextResponse.json(sightings);
}

/** Manuelle Sichtung (Kennzeichen eintippen) – matcht und schaltet ggf. Shelly. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const parsed = vehicleSightingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.cameraId) {
    const camera = await db.camera.findFirst({
      where: { id: parsed.data.cameraId, accountId: accountId! },
      select: { id: true },
    });
    if (!camera) {
      return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 400 });
    }
  }

  const result = await processVehicleSighting({
    accountId: accountId!,
    cameraId: parsed.data.cameraId ?? null,
    plate: parsed.data.plate,
    source: "MANUAL",
    seenAt: parsed.data.seenAt ? new Date(parsed.data.seenAt) : undefined,
  });

  return NextResponse.json(result, { status: 201 });
}

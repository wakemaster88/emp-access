import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { processVehicleSighting } from "@/lib/vehicles";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * POST (Hub): Fahrzeug-Schnappschuss + optionales Kennzeichen.
 * Query: cameraId, optional plate
 * Body: raw JPEG
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const q = request.nextUrl.searchParams;
  const cameraId = Number(q.get("cameraId"));
  if (!Number.isInteger(cameraId)) {
    return NextResponse.json({ error: "cameraId fehlt" }, { status: 400 });
  }
  const plate = q.get("plate");

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true },
  });
  if (!camera) return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 404 });

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return NextResponse.json({ error: "Kein gültiges JPEG" }, { status: 400 });
  }
  if (buf.length > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ error: "Schnappschuss zu groß" }, { status: 413 });
  }

  const now = new Date();
  await db.camera.update({
    where: { id: cameraId },
    data: { snapshot: buf, snapshotAt: now, lastSeenAt: now },
  });

  const result = await processVehicleSighting({
    accountId: account.id,
    cameraId,
    plate: plate?.trim() || null,
    source: plate?.trim() ? "CAMERA_PLATE" : "CAMERA_VEHICLE",
    seenAt: now,
    snapshot: buf,
  });

  return NextResponse.json({
    ok: true,
    bytes: buf.length,
    ...result,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { processParkingViolation } from "@/lib/parking-violations";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * POST (Hub): Fahrzeug steht zu lange in einer gesperrten Fläche.
 * Query: cameraId, vehicles, seconds
 * Body: rohes JPEG
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
  const vehicles = Math.max(1, Number(q.get("vehicles")) || 1);
  const seconds = Math.max(0, Number(q.get("seconds")) || 0);

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true, name: true },
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
  // select {id}: sonst gibt RETURNING die JPEG-Bytes wieder mit zurück.
  await db.camera.update({
    where: { id: cameraId },
    data: { snapshot: buf, snapshotAt: now, lastSeenAt: now },
    select: { id: true },
  });

  const result = await processParkingViolation({
    accountId: account.id,
    cameraId,
    cameraName: camera.name,
    vehicles,
    seconds,
    snapshot: buf,
    at: now,
  });

  return NextResponse.json({ ok: true, ...result });
}

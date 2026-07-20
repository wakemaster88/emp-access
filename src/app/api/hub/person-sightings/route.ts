import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { processCameraPersonEvent } from "@/lib/persons";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * POST (Hub, Token-Auth): Schnappschuss bei klarer Personen-/Gesichtserkennung.
 * Query: cameraId=<id>
 * Body: raw JPEG (Content-Type image/jpeg)
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const cameraId = Number(request.nextUrl.searchParams.get("cameraId"));
  if (!Number.isInteger(cameraId)) {
    return NextResponse.json({ error: "cameraId fehlt" }, { status: 400 });
  }

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
  // Kamera-Livebild ebenfalls aktualisieren.
  await db.camera.update({
    where: { id: cameraId },
    data: { snapshot: buf, snapshotAt: now, lastSeenAt: now },
  });

  const result = await processCameraPersonEvent({
    accountId: account.id,
    cameraId,
    seenAt: now,
    snapshot: buf,
  });

  return NextResponse.json({
    ok: true,
    bytes: buf.length,
    sightings: result.sightings,
    triggered: result.triggered,
  });
}

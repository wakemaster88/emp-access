import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

// Sub-Stream-JPEGs liegen bei ~100-500 KB, Main-Stream bis ~2 MB.
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * POST (Hub, Token-Auth): nimmt einen Schnappschuss als rohes JPEG
 * (Content-Type image/jpeg) entgegen und speichert ihn an der Kamera.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const { id } = await params;
  const cameraId = Number(id);
  if (isNaN(cameraId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true },
  });
  if (!camera) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const buf = Buffer.from(await request.arrayBuffer());
  // JPEG-Magic-Bytes pruefen, damit keine Fehlerseiten als Bild landen.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return NextResponse.json({ error: "Kein gültiges JPEG" }, { status: 400 });
  }
  if (buf.length > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ error: "Schnappschuss zu groß" }, { status: 413 });
  }

  const now = new Date();
  // select {id}: ohne select wuerde Prisma per RETURNING die komplette Zeile
  // inkl. der eben geschriebenen JPEG-Bytes zurueckuebertragen (Neon-Egress).
  await db.camera.update({
    where: { id: cameraId },
    data: { snapshot: buf, snapshotAt: now, lastSeenAt: now },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, bytes: buf.length });
}

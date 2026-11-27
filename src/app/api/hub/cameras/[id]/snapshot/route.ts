import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { snapshotMarksSeen } from "@/lib/parking";
import { previewAllowed, previewWriteData } from "@/lib/camera-live-mode";

// Sub-Stream-JPEGs liegen bei ~100-500 KB, Main-Stream bis ~2 MB.
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * POST (Hub, Token-Auth): nimmt einen Schnappschuss als rohes JPEG
 * (Content-Type image/jpeg) entgegen und speichert ihn an der Kamera.
 * Ein Bild setzt auch „zuletzt gesehen“ der Kamera; ein Bild der Parkfläche
 * (`?source=parking`) nur mit `live=1`, also wenn es aus dem laufenden
 * Videostrom des Trackers stammt (snapshotMarksSeen).
 *
 * Livebild und Vorschau „nur auf Tippen“ oder „aus“: Das Bild wird nicht
 * gespeichert, „zuletzt gesehen“ wie sonst. Die Antwort ist trotzdem ein
 * Erfolg (`skipped`), damit ein älterer Hub weder neu versucht noch einen
 * Fehler loggt.
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
    select: { id: true, liveMode: true },
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
  const seen = snapshotMarksSeen(request.nextUrl.searchParams);
  const data = previewWriteData(camera.liveMode, buf, now, seen);
  // select {id}: ohne select wuerde Prisma per RETURNING die komplette Zeile
  // inkl. der eben geschriebenen JPEG-Bytes zurueckuebertragen (Neon-Egress).
  if (Object.keys(data).length > 0) {
    await db.camera.update({ where: { id: cameraId }, data, select: { id: true } });
  }
  if (!previewAllowed(camera.liveMode)) {
    return NextResponse.json({ ok: true, skipped: "liveMode", bytes: 0 });
  }
  return NextResponse.json({ ok: true, bytes: buf.length });
}

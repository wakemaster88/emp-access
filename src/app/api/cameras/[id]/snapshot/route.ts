import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/** GET (Session): liefert den zuletzt gespeicherten Schnappschuss als JPEG. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const cameraId = Number(id);
  if (isNaN(cameraId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  // Zweistufig: erst nur den Zeitstempel lesen. Bei unveraendertem Bild
  // (ETag-Match) antworten wir mit 304, ohne die JPEG-Bytes aus der DB
  // zu uebertragen – spart DB-Egress bei Browser-Refreshes.
  const meta = await db.camera.findFirst({
    where: { id: cameraId, accountId: accountId! },
    select: { snapshotAt: true },
  });
  if (!meta) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!meta.snapshotAt) {
    return NextResponse.json({ error: "Noch kein Schnappschuss vorhanden" }, { status: 404 });
  }

  const etag = `W/"snap-${meta.snapshotAt.getTime()}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "private, max-age=5, must-revalidate",
    "Last-Modified": meta.snapshotAt.toUTCString(),
  } as const;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: accountId! },
    select: { snapshot: true },
  });
  if (!camera?.snapshot) {
    return NextResponse.json({ error: "Noch kein Schnappschuss vorhanden" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(camera.snapshot), {
    headers: { ...headers, "Content-Type": "image/jpeg" },
  });
}

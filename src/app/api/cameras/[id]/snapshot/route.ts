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

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: accountId! },
    select: { snapshot: true, snapshotAt: true },
  });
  if (!camera) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!camera.snapshot) {
    return NextResponse.json({ error: "Noch kein Schnappschuss vorhanden" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(camera.snapshot), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "Last-Modified": (camera.snapshotAt ?? new Date()).toUTCString(),
    },
  });
}

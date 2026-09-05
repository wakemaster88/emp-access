import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { resolveBinary } from "@/lib/blob-store";

/** GET (Session): Kamera-Schnappschuss zum Scan-Zeitpunkt als JPEG. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const scanId = Number(id);
  if (isNaN(scanId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const snapshot = await db.scanSnapshot.findFirst({
    where: { scanId, accountId: accountId! },
    select: { image: true, blobPathname: true, capturedAt: true },
  });
  const bytes = snapshot
    ? await resolveBinary({ blob: snapshot.blobPathname, bytes: snapshot.image })
    : null;
  if (!snapshot || !bytes) {
    return NextResponse.json({ error: "Kein Schnappschuss vorhanden" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      // Bild ist unveraenderlich – Browser darf es cachen.
      "Cache-Control": "private, max-age=86400, immutable",
      "Last-Modified": snapshot.capturedAt.toUTCString(),
    },
  });
}

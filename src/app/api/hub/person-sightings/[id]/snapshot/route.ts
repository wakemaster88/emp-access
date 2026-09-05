import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { resolveBinary } from "@/lib/blob-store";

/** GET (Hub, Token): JPEG einer Sichtung fuer FACE_ENROLL. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(_request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const id = Number((await params).id);
  if (isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const sighting = await db.personSighting.findFirst({
    where: { id, accountId: account.id },
    select: { snapshot: true, snapshotBlob: true, seenAt: true },
  });
  if (!sighting) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const bytes = await resolveBinary({ blob: sighting.snapshotBlob, bytes: sighting.snapshot });
  if (!bytes) {
    return NextResponse.json({ error: "Kein Schnappschuss" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "Last-Modified": sighting.seenAt.toUTCString(),
    },
  });
}

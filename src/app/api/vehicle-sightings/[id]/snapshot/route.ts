import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

/** GET (Session): Schnappschuss einer Fahrzeugsichtung als JPEG. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;

  const id = Number((await params).id);
  if (isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  // Ohne tenantClient: BYTEA (~1 MB) nicht in eine WS-Transaktion packen.
  const sighting = await prisma.vehicleSighting.findFirst({
    where: { id, accountId: accountId! },
    select: { snapshot: true, seenAt: true },
  });
  if (!sighting) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!sighting.snapshot) {
    return NextResponse.json({ error: "Kein Schnappschuss" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(sighting.snapshot), {
    headers: {
      "Content-Type": "image/jpeg",
      // Bild ist pro Sichtung unveraenderlich – Browser darf lange cachen.
      "Cache-Control": "private, max-age=86400, immutable",
      "Last-Modified": sighting.seenAt.toUTCString(),
    },
  });
}

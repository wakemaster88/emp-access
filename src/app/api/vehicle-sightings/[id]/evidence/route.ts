import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { resolveBinary } from "@/lib/blob-store";

/** GET (Session): Ausschnitt in voller Auflösung einer Halteverbot-Sichtung als JPEG. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;

  const id = Number((await params).id);
  if (isNaN(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const sighting = await prisma.vehicleSighting.findFirst({
    where: { id, accountId: accountId! },
    select: { evidence: true, evidenceBlob: true, seenAt: true },
  });
  if (!sighting) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const bytes = await resolveBinary({ blob: sighting.evidenceBlob, bytes: sighting.evidence });
  if (!bytes) {
    return NextResponse.json({ error: "Kein Ausschnitt" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      // Kennzeichen lesbar: nur kurz im Browser-Cache halten.
      "Cache-Control": "private, max-age=300",
      "Last-Modified": sighting.seenAt.toUTCString(),
    },
  });
}

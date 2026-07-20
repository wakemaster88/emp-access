import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

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
    select: { snapshot: true, seenAt: true },
  });
  if (!sighting) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!sighting.snapshot) {
    return NextResponse.json({ error: "Kein Schnappschuss" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(sighting.snapshot), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "Last-Modified": sighting.seenAt.toUTCString(),
    },
  });
}

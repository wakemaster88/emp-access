import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const trackId = Number(id);
  if (isNaN(trackId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioTrack.findFirst({
    where: { id: trackId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const track = await db.audioTrack.update({
    where: { id: trackId },
    data: {
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
      artist:
        body.artist === undefined
          ? undefined
          : typeof body.artist === "string" && body.artist.trim()
            ? body.artist.trim()
            : null,
    },
  });

  return NextResponse.json(track);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const trackId = Number(id);
  if (isNaN(trackId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioTrack.findFirst({
    where: { id: trackId, accountId: accountId! },
    select: { id: true, blobPathname: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.audioTrack.delete({ where: { id: trackId } });

  // Datei im Storage aufräumen. Schlägt das fehl, bleibt nur eine verwaiste
  // Datei zurück – der Track ist bereits weg, also kein harter Fehler.
  if (existing.blobPathname && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { del } = await import("@vercel/blob");
      await del(existing.blobPathname);
    } catch {
      // bewusst ignoriert
    }
  }

  return NextResponse.json({ ok: true });
}

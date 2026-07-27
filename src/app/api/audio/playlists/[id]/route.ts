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
  const playlistId = Number(id);
  if (isNaN(playlistId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioPlaylist.findFirst({
    where: { id: playlistId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();

  // Titelliste wird als Ganzes ersetzt – das hält die Reihenfolge eindeutig.
  if (Array.isArray(body.trackIds)) {
    const ids: number[] = body.trackIds
      .map(Number)
      .filter((n: number) => Number.isInteger(n) && n > 0);
    const owned = await db.audioTrack.findMany({
      where: { id: { in: ids }, accountId: accountId! },
      select: { id: true },
    });
    const validIds = new Set(owned.map((t) => t.id));
    const ordered = ids.filter((n) => validIds.has(n));

    await db.audioPlaylistItem.deleteMany({ where: { playlistId } });
    if (ordered.length > 0) {
      await db.audioPlaylistItem.createMany({
        data: ordered.map((trackId, index) => ({ playlistId, trackId, sortOrder: index })),
      });
    }
  }

  const playlist = await db.audioPlaylist.update({
    where: { id: playlistId },
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      description:
        body.description === undefined
          ? undefined
          : typeof body.description === "string" && body.description.trim()
            ? body.description.trim()
            : null,
      shuffle: typeof body.shuffle === "boolean" ? body.shuffle : undefined,
      crossfadeSec: Number.isFinite(Number(body.crossfadeSec))
        ? Math.min(12, Math.max(0, Math.round(Number(body.crossfadeSec))))
        : undefined,
    },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { track: { select: { id: true, title: true, artist: true, durationSec: true } } },
      },
    },
  });

  return NextResponse.json(playlist);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const playlistId = Number(id);
  if (isNaN(playlistId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioPlaylist.findFirst({
    where: { id: playlistId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.audioPlaylist.delete({ where: { id: playlistId } });
  return NextResponse.json({ ok: true });
}

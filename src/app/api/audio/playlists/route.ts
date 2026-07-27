import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const playlists = await db.audioPlaylist.findMany({
    where: { accountId: accountId! },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { track: { select: { id: true, title: true, artist: true, durationSec: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(playlists);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name erforderlich" }, { status: 400 });

  const trackIds = Array.isArray(body.trackIds)
    ? body.trackIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];

  // Nur Tracks des eigenen Mandanten aufnehmen.
  const owned = await db.audioTrack.findMany({
    where: { id: { in: trackIds }, accountId: accountId! },
    select: { id: true },
  });
  const validIds = new Set(owned.map((t) => t.id));
  const ordered: number[] = trackIds.filter((n: number) => validIds.has(n));

  const playlist = await db.audioPlaylist.create({
    data: {
      accountId: accountId!,
      name,
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null,
      shuffle: body.shuffle ?? true,
      crossfadeSec: Number.isFinite(Number(body.crossfadeSec))
        ? Math.min(12, Math.max(0, Math.round(Number(body.crossfadeSec))))
        : 3,
      items: {
        create: ordered.map((trackId, index) => ({ trackId, sortOrder: index })),
      },
    },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { track: { select: { id: true, title: true, artist: true, durationSec: true } } },
      },
    },
  });

  return NextResponse.json(playlist, { status: 201 });
}

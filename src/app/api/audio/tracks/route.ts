import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const TRACK_KINDS = ["MUSIC", "JINGLE", "CHIME", "ANNOUNCEMENT"] as const;
type TrackKind = (typeof TRACK_KINDS)[number];

function parseKind(value: unknown): TrackKind {
  return TRACK_KINDS.includes(value as TrackKind) ? (value as TrackKind) : "MUSIC";
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const kind = request.nextUrl.searchParams.get("kind");

  const tracks = await db.audioTrack.findMany({
    where: {
      accountId: accountId!,
      ...(TRACK_KINDS.includes(kind as TrackKind) ? { kind: kind as TrackKind } : {}),
    },
    orderBy: [{ kind: "asc" }, { title: "asc" }],
  });
  return NextResponse.json(tracks);
}

/** Registriert eine bereits hochgeladene Datei oder eine externe URL. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Gültige Datei-URL erforderlich" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Titel erforderlich" }, { status: 400 });
  }

  const track = await db.audioTrack.create({
    data: {
      accountId: accountId!,
      title,
      artist: typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : null,
      kind: parseKind(body.kind),
      url,
      blobPathname:
        typeof body.blobPathname === "string" && body.blobPathname.trim()
          ? body.blobPathname.trim()
          : null,
      contentType:
        typeof body.contentType === "string" && body.contentType.trim()
          ? body.contentType.trim()
          : null,
      sizeBytes: Number.isFinite(Number(body.sizeBytes)) ? Math.round(Number(body.sizeBytes)) : null,
      durationSec: Number.isFinite(Number(body.durationSec))
        ? Math.round(Number(body.durationSec))
        : null,
    },
  });

  return NextResponse.json(track, { status: 201 });
}

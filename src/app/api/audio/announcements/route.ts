import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { MAX_ANNOUNCEMENT_CHARS, parseZoneIds } from "@/lib/audio";

const SOURCES = ["TTS", "FILE", "LIVE"] as const;
type Source = (typeof SOURCES)[number];

/** 0 = normal, 100 = Notfall (unterbricht laufende Durchsagen). */
function clampPriority(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const announcements = await db.audioAnnouncement.findMany({
    where: { accountId: accountId! },
    include: { track: { select: { id: true, title: true, url: true, durationSec: true } } },
    orderBy: [{ isTemplate: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(announcements);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name erforderlich" }, { status: 400 });

  const source: Source = SOURCES.includes(body.source as Source)
    ? (body.source as Source)
    : "TTS";

  const text =
    typeof body.text === "string" && body.text.trim()
      ? body.text.trim().slice(0, MAX_ANNOUNCEMENT_CHARS)
      : null;

  if (source === "TTS" && !text) {
    return NextResponse.json({ error: "Ansagetext erforderlich" }, { status: 400 });
  }

  let trackId: number | null = null;
  if (body.trackId != null && body.trackId !== "") {
    const candidate = Number(body.trackId);
    const track = await db.audioTrack.findFirst({
      where: { id: candidate, accountId: accountId! },
      select: { id: true },
    });
    if (!track) return NextResponse.json({ error: "Audiodatei nicht gefunden" }, { status: 404 });
    trackId = candidate;
  }

  if (source !== "TTS" && !trackId) {
    return NextResponse.json({ error: "Audiodatei erforderlich" }, { status: 400 });
  }

  // Zonen gegen den Mandanten prüfen; leeres Array = alle aktiven Zonen.
  const requestedZones = parseZoneIds(body.zoneIds);
  let zoneIds: number[] = [];
  if (requestedZones.length > 0) {
    const owned = await db.audioZone.findMany({
      where: { id: { in: requestedZones }, accountId: accountId! },
      select: { id: true },
    });
    zoneIds = owned.map((z) => z.id);
  }

  const announcement = await db.audioAnnouncement.create({
    data: {
      accountId: accountId!,
      name,
      source,
      text,
      voice: typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : null,
      trackId,
      chime: body.chime ?? true,
      repeatCount: Math.min(5, Math.max(1, Math.round(Number(body.repeatCount) || 1))),
      priority: clampPriority(body.priority),
      zoneIds,
      isTemplate: body.isTemplate ?? false,
    },
    include: { track: { select: { id: true, title: true, url: true, durationSec: true } } },
  });

  return NextResponse.json(announcement, { status: 201 });
}

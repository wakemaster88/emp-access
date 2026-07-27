import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { MAX_ANNOUNCEMENT_CHARS, parseZoneIds } from "@/lib/audio";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const announcementId = Number(id);
  if (isNaN(announcementId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await db.audioAnnouncement.findFirst({
    where: { id: announcementId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();

  // Textänderung macht die gerenderte Sprachdatei ungültig: Verknüpfung lösen,
  // damit beim nächsten Abspielen neu gerendert wird. Der alte Track bleibt im
  // TTS-Cache liegen und wird wiederverwendet, falls der Text zurückgeändert wird.
  let trackId: number | null | undefined = undefined;
  const textChanged =
    typeof body.text === "string" && body.text.trim().slice(0, MAX_ANNOUNCEMENT_CHARS) !== existing.text;
  const voiceChanged = body.voice !== undefined && (body.voice || null) !== existing.voice;
  if (existing.source === "TTS" && (textChanged || voiceChanged)) {
    trackId = null;
  }

  if (body.trackId !== undefined && existing.source !== "TTS") {
    if (body.trackId === null || body.trackId === "") {
      trackId = null;
    } else {
      const candidate = Number(body.trackId);
      const track = await db.audioTrack.findFirst({
        where: { id: candidate, accountId: accountId! },
        select: { id: true },
      });
      if (!track) return NextResponse.json({ error: "Audiodatei nicht gefunden" }, { status: 404 });
      trackId = candidate;
    }
  }

  let zoneIds: number[] | undefined = undefined;
  if (body.zoneIds !== undefined) {
    const requested = parseZoneIds(body.zoneIds);
    if (requested.length === 0) {
      zoneIds = [];
    } else {
      const owned = await db.audioZone.findMany({
        where: { id: { in: requested }, accountId: accountId! },
        select: { id: true },
      });
      zoneIds = owned.map((z) => z.id);
    }
  }

  const announcement = await db.audioAnnouncement.update({
    where: { id: announcementId },
    data: {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      text:
        body.text === undefined
          ? undefined
          : typeof body.text === "string" && body.text.trim()
            ? body.text.trim().slice(0, MAX_ANNOUNCEMENT_CHARS)
            : null,
      voice:
        body.voice === undefined
          ? undefined
          : typeof body.voice === "string" && body.voice.trim()
            ? body.voice.trim()
            : null,
      ...(trackId !== undefined ? { trackId } : {}),
      ...(zoneIds !== undefined ? { zoneIds } : {}),
      chime: typeof body.chime === "boolean" ? body.chime : undefined,
      repeatCount: Number.isFinite(Number(body.repeatCount))
        ? Math.min(5, Math.max(1, Math.round(Number(body.repeatCount))))
        : undefined,
      priority: Number.isFinite(Number(body.priority))
        ? Math.min(100, Math.max(0, Math.round(Number(body.priority))))
        : undefined,
      isTemplate: typeof body.isTemplate === "boolean" ? body.isTemplate : undefined,
    },
    include: { track: { select: { id: true, title: true, url: true, durationSec: true } } },
  });

  return NextResponse.json(announcement);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const announcementId = Number(id);
  if (isNaN(announcementId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await db.audioAnnouncement.findFirst({
    where: { id: announcementId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.audioAnnouncement.delete({ where: { id: announcementId } });
  return NextResponse.json({ ok: true });
}

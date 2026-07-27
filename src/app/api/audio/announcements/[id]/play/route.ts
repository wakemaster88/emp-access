/**
 * Durchsage abspielen: rendert bei Bedarf die Sprachdatei und legt für jede
 * Zielzone einen Job an. Optional lassen sich abweichende Zielzonen mitgeben
 * (z. B. Notfalldurchsage auf alle Zonen statt auf die gespeicherten).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  TtsNotConfiguredError,
  ensureAnnouncementTrack,
  parseZoneIds,
  queueAnnouncement,
  resolveTargetZones,
} from "@/lib/audio";

export async function POST(
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

  const announcement = await db.audioAnnouncement.findFirst({
    where: { id: announcementId, accountId: accountId! },
    include: { track: { select: { id: true, url: true, durationSec: true } } },
  });
  if (!announcement) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const overrideZones = parseZoneIds(body.zoneIds);
  const targetZoneIds =
    overrideZones.length > 0 ? overrideZones : parseZoneIds(announcement.zoneIds);

  const zones = await resolveTargetZones(db, accountId!, targetZoneIds);
  if (zones.length === 0) {
    return NextResponse.json({ error: "Keine aktive Zielzone" }, { status: 400 });
  }

  let track;
  try {
    track = await ensureAnnouncementTrack(db, accountId!, announcement);
  } catch (error) {
    if (error instanceof TtsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }
    const message = error instanceof Error ? error.message : "Sprachausgabe fehlgeschlagen";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const queued = await queueAnnouncement(
    db,
    accountId!,
    { ...announcement, track },
    zones,
    typeof body.triggerKind === "string" ? body.triggerKind : "MANUAL"
  );

  return NextResponse.json({
    ok: true,
    queued,
    zones: zones.map((z) => ({ id: z.id, name: z.name })),
  });
}

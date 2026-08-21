/**
 * Direktsteuerung einer Zone aus dem Dashboard: Musik starten, stoppen,
 * Lautstärke ändern oder den lokalen Dateicache des Pi abgleichen.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { queueZoneCommand } from "@/lib/audio";
import { controlAudioZone } from "@/lib/audio-integration";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const zoneId = Number(id);
  if (isNaN(zoneId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const zone = await db.audioZone.findFirst({
    where: { id: zoneId, accountId: accountId! },
  });
  if (!zone) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const action = body.action;

  if (action === "SYNC_LIBRARY") {
    await queueZoneCommand(db, accountId!, [zone], "SYNC_LIBRARY", null, "MANUAL");
    return NextResponse.json({ ok: true });
  }

  if (action === "STOP" || action === "VOLUME" || action === "PLAY") {
    const result = await controlAudioZone(db, accountId!, zone, {
      action,
      volume: body.volume,
      playlistId: body.playlistId,
      trackId: body.trackId,
      streamUrl: body.streamUrl,
      persistStreamUrl: true,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, volume: result.volume });
  }

  return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
}

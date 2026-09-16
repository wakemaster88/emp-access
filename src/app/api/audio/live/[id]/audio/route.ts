/**
 * Ein Stück Ton einer Live-Durchsage entgegennehmen: rohes PCM (16 Bit
 * little-endian, mono) als Body, laufende Nummer in `?seq=`. Die Antwort
 * meldet, ob die Sitzung noch läuft und wie weit die Zonen sind – der Browser
 * braucht dafür keine eigene Statusabfrage.
 *
 * Doppelt geschickte Nummern (Wiederholung nach Netzfehler) werden verworfen.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { endLiveSession, liveZoneStates } from "@/lib/audio";
import { LIVE_KEEP_CHUNKS, LIVE_MAX_CHUNK_BYTES, isLiveSessionOpen } from "@/lib/audio-live";

/** Alle so viele Stücke wird Ton weggeräumt, den kein Pi mehr holt. */
const TRIM_EVERY = 25;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const sessionId = Number(id);
  const seq = Number(request.nextUrl.searchParams.get("seq"));
  if (!Number.isInteger(sessionId) || !Number.isInteger(seq) || seq < 1) {
    return NextResponse.json({ error: "Ungültige Sitzung oder Nummer" }, { status: 400 });
  }

  const live = await db.audioLiveSession.findFirst({
    where: { id: sessionId, ...(accountId ? { accountId } : {}) },
    select: { status: true, lastChunkAt: true, startedAt: true },
  });
  if (!live) return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });

  const now = new Date();
  if (!isLiveSessionOpen(live, now)) {
    if (live.status === "LIVE") await endLiveSession(db, sessionId, now);
    return NextResponse.json({ state: "ENDED", zones: await liveZoneStates(db, sessionId) });
  }

  const data = new Uint8Array(await request.arrayBuffer());
  if (data.length === 0 || data.length % 2 !== 0 || data.length > LIVE_MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Ungültiges Tonstück" }, { status: 400 });
  }

  await db.audioLiveChunk.createMany({
    data: [{ sessionId, seq, data }],
    skipDuplicates: true,
  });
  await db.audioLiveSession.updateMany({
    where: { id: sessionId, lastSeq: { lt: seq } },
    data: { lastSeq: seq, lastChunkAt: now },
  });
  if (seq % TRIM_EVERY === 0) {
    await db.audioLiveChunk.deleteMany({
      where: { sessionId, seq: { lte: seq - LIVE_KEEP_CHUNKS } },
    });
  }

  return NextResponse.json({ state: "LIVE", zones: await liveZoneStates(db, sessionId) });
}

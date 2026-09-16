/**
 * Live-Durchsage starten: legt die Sitzung an und für jede Zielzone einen
 * LIVE-Job. Den Ton schickt der Browser danach stückweise an
 * `/api/audio/live/[id]/audio`, beendet wird über `/api/audio/live/[id]/end`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { endLiveSession, isPlayerOnline, parseZoneIds } from "@/lib/audio";
import { LIVE_SAMPLE_RATE, isLiveSessionOpen } from "@/lib/audio-live";

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  if (!accountId) {
    return NextResponse.json({ error: "Kein Account zugeordnet" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const zoneIds = parseZoneIds(body.zoneIds);
  const now = new Date();

  const zones = await db.audioZone.findMany({
    where: { accountId, isActive: true, ...(zoneIds.length > 0 ? { id: { in: zoneIds } } : {}) },
    select: { id: true, name: true, device: { select: { lastUpdate: true } } },
    orderBy: { sortOrder: "asc" },
  });
  if (zones.length === 0) {
    return NextResponse.json({ error: "Keine aktive Zielzone" }, { status: 400 });
  }

  // Zwei Leute gleichzeitig auf derselben Zone ergäben ein Durcheinander, das
  // keiner versteht. Eine Sitzung, deren Browser verstummt ist, zählt nicht mehr.
  const running = await db.audioLiveSession.findMany({
    where: { accountId, status: "LIVE", jobs: { some: { zoneId: { in: zones.map((z) => z.id) } } } },
    select: { id: true, status: true, lastChunkAt: true, startedAt: true, startedByName: true },
  });
  for (const other of running) {
    if (isLiveSessionOpen(other, now)) {
      const who = other.startedByName ? ` (${other.startedByName})` : "";
      return NextResponse.json(
        { error: `Auf diesen Zonen läuft bereits eine Live-Durchsage${who}` },
        { status: 409 }
      );
    }
    await endLiveSession(db, other.id, now);
  }

  const priority = body.emergency ? 100 : 0;
  const chime = body.chime !== false;
  const live = await db.audioLiveSession.create({
    data: {
      accountId,
      startedByName: session.session.user.name?.slice(0, 120) || null,
      sampleRate: LIVE_SAMPLE_RATE,
      chime,
      priority,
    },
    select: { id: true, sampleRate: true },
  });

  await db.audioJob.createMany({
    data: zones.map((zone) => ({
      accountId,
      zoneId: zone.id,
      kind: "LIVE" as const,
      liveSessionId: live.id,
      triggerKind: body.emergency ? "EMERGENCY" : "MANUAL",
      payload: { sessionId: live.id, chime, priority, sampleRate: live.sampleRate },
    })),
  });

  return NextResponse.json(
    {
      id: live.id,
      sampleRate: live.sampleRate,
      zones: zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        hasDevice: zone.device !== null,
        deviceOnline: isPlayerOnline(zone.device?.lastUpdate),
      })),
    },
    { status: 201 }
  );
}

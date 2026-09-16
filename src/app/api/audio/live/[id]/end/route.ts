/**
 * Live-Durchsage beenden. Die Pis spielen noch aus, was schon unterwegs ist,
 * und geben die Zone dann frei.
 *
 * Kommt auch per `navigator.sendBeacon`, wenn der Tab geschlossen wird – daher
 * ohne Body.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { endLiveSession, liveZoneStates } from "@/lib/audio";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) {
    return NextResponse.json({ error: "Ungültige Sitzung" }, { status: 400 });
  }

  const live = await db.audioLiveSession.findFirst({
    where: { id: sessionId, ...(accountId ? { accountId } : {}) },
    select: { id: true },
  });
  if (!live) return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });

  await endLiveSession(db, sessionId);
  return NextResponse.json({ state: "ENDED", zones: await liveZoneStates(db, sessionId) });
}

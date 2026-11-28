/**
 * Ton einer Live-Durchsage für den Zonen-Pi.
 *
 * GET ?id=<deviceId>&session=<sessionId>&after=<seq>
 *
 * Format und Ablauf: `src/lib/audio-live-feed.ts` (gemeinsam mit dem Monitor
 * im Browser).
 */
import { NextRequest, NextResponse } from "next/server";
import { deviceTokenMismatch, validateApiToken } from "@/lib/api-token-auth";
import { liveAudioResponse, parseLiveAfter } from "@/lib/audio-live-feed";

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request, { allowDevice: true });
  if ("error" in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const deviceId = Number(params.get("id"));
  const sessionId = Number(params.get("session"));
  const requestedAfter = parseLiveAfter(params.get("after"));
  if (
    !Number.isInteger(deviceId) ||
    !Number.isInteger(sessionId) ||
    (requestedAfter !== null && !Number.isInteger(requestedAfter))
  ) {
    return NextResponse.json({ error: "id, session und after müssen Zahlen sein" }, { status: 400 });
  }
  const mismatch = deviceTokenMismatch(auth, deviceId);
  if (mismatch) return mismatch;

  const { db } = auth;
  // Nur Zonen, an die die Durchsage ging, dürfen mithören.
  const job = await db.audioJob.findFirst({
    where: { liveSessionId: sessionId, kind: "LIVE", zone: { deviceId } },
    select: { id: true },
  });
  if (!job) return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });

  const response = await liveAudioResponse(db, sessionId, requestedAfter);
  return response ?? NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });
}

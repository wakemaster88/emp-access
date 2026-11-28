/**
 * Ton einer Live-Durchsage für den Monitor, der eine Zone im Browser abspielt.
 *
 * GET ?session=<sessionId>&after=<seq> – Format wie beim Pi
 * (`src/lib/audio-live-feed.ts`): rohes PCM, Zustand in den X-Live-Headern.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { isMonitorAudioType } from "@/lib/audio-constants";
import { liveAudioResponse, parseLiveAfter } from "@/lib/audio-live-feed";

export const maxDuration = 10;

/** Während einer Durchsage gut zwei Abrufe je Sekunde. */
const LIVE_LIMIT = { limit: 600, windowMs: 60_000 } as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-audio-live", LIVE_LIMIT);
  if (limited) return limited;

  const search = request.nextUrl.searchParams;
  const sessionId = Number(search.get("session"));
  const after = parseLiveAfter(search.get("after"));
  if (!Number.isInteger(sessionId) || (after !== null && !Number.isInteger(after))) {
    return NextResponse.json({ error: "session und after müssen Zahlen sein" }, { status: 400 });
  }

  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || !isMonitorAudioType(monitor.type)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const db = tenantClient(monitor.accountId);
  // Nur die Zone, an die die Durchsage ging, darf mithören.
  const job = await db.audioJob.findFirst({
    where: { liveSessionId: sessionId, kind: "LIVE", zone: { monitorId: monitor.id } },
    select: { id: true },
  });
  if (!job) return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });

  const response = await liveAudioResponse(db, sessionId, after);
  return response ?? NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });
}

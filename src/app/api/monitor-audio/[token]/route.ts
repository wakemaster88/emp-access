/**
 * Monitor-Seite als Abspieler einer Audio-Zone (Browser statt Pi).
 *
 * GET            – Vorschau: Spielt dieser Monitor eine Zone? `{ zone: { id, name } | null }`.
 *                  Holt keine Jobs ab – so bleibt ein Gerät, auf dem niemand
 *                  „Hier abspielen“ getippt hat, still und nimmt nichts weg.
 * GET ?spielen=1 – wie der Pi: Zonenkonfiguration und offene Jobs (danach SENT).
 * POST           – Heartbeat mit Ist-Zustand und Jobstatus.
 *
 * Zugang über den Link-Token des Monitors (öffentlich wie die übrigen
 * Monitor-Endpunkte). Antwort und Heartbeat teilt sich der Monitor mit dem Pi
 * (`src/lib/audio-player-state.ts`).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { isMonitorAudioType } from "@/lib/audio-constants";
import { playerStateBody, playerZoneInclude, recordPlayerReport } from "@/lib/audio-player-state";
import { MONITOR_AUDIO_JOB_MAX_AGE_MS } from "@/lib/monitor-audio";
import { ifNoneMatchMatches, jsonEtag } from "@/lib/http-etag";

export const maxDuration = 10;

/** Ein spielender Monitor fragt alle 8 s, dazu Meldungen; Luft für mehrere Geräte hinter einer IP. */
const POLL_LIMIT = { limit: 120, windowMs: 60_000 } as const;
const REPORT_LIMIT = { limit: 120, windowMs: 60_000 } as const;

const STALE_MESSAGE =
  "Verworfen: Der Monitor hat den Befehl nicht rechtzeitig abgeholt (Seite zu oder Ton dort nicht eingeschaltet)";

async function findMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || !isMonitorAudioType(monitor.type)) return null;
  return monitor;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-audio", POLL_LIMIT);
  if (limited) return limited;

  const monitor = await findMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const db = tenantClient(monitor.accountId);
  const playing = request.nextUrl.searchParams.get("spielen") === "1";

  let body: unknown;
  let jobCount = 0;
  if (!playing) {
    const zone = await db.audioZone.findFirst({
      where: { monitorId: monitor.id },
      select: { id: true, name: true },
    });
    body = { zone };
  } else {
    const zone = await db.audioZone.findFirst({
      where: { monitorId: monitor.id },
      include: playerZoneInclude,
    });
    if (!zone) {
      body = { zone: null, jobs: [] };
    } else {
      const state = await playerStateBody(db, zone, {
        staleBefore: new Date(Date.now() - MONITOR_AUDIO_JOB_MAX_AGE_MS),
        staleMessage: STALE_MESSAGE,
      });
      jobCount = state.jobs.length;
      body = state;
    }
  }

  // Wie beim Pi: 304 nur ohne Jobs, Jobs gehen immer mit vollem Body raus.
  const etag = jsonEtag(body);
  const headers = { ETag: etag, "Cache-Control": "no-store" };
  if (jobCount === 0 && ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(body, { headers });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-audio-report", REPORT_LIMIT);
  if (limited) return limited;

  const monitor = await findMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  }

  const db = tenantClient(monitor.accountId);
  const zone = await db.audioZone.findFirst({
    where: { monitorId: monitor.id },
    select: { id: true, volume: true },
  });
  if (!zone) return NextResponse.json({ error: "Keine Zone" }, { status: 404 });

  // Ein Monitor hat keine AirPlay-/Bluetooth-Empfänger: Feld nie übernehmen.
  const report = { ...(body as Record<string, unknown>) };
  delete report.externalSource;
  const pending = await recordPlayerReport(db, zone, report);
  return NextResponse.json({ ok: true, pendingJobs: pending });
}

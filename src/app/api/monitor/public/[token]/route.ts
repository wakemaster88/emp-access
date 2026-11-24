import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { runPublicMonitorPoll, parseMonitorIdList } from "@/lib/monitor-public-poll";

/** Kurze Requests – kein Dauer-SSE mehr (Vercel 10s-Limit + Neon-Reconnect-Sturm) */
export const maxDuration = 25;

/**
 * Ein Monitor fragt alle 5 s ab (12 pro Minute). Die Grenze reicht fuer
 * Dutzende Geraete mit demselben Link hinter einer IP und bremst nur Schleifen.
 */
const POLL_LIMIT = { limit: 600, windowMs: 60_000 } as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-poll", POLL_LIMIT);
  if (limited) return limited;

  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
  });

  // Die Abfrage gehoert zur Scan-Monitor-Seite; andere Link-Typen haben eigene Routen.
  if (!monitor || !monitor.isActive || monitor.type !== "MONITOR") {
    return new Response("Monitor nicht gefunden oder inaktiv", { status: 404 });
  }

  const deviceIds = parseMonitorIdList(monitor.deviceIds);
  const areaIds = parseMonitorIdList(monitor.areaIds);
  const controlDeviceIds = parseMonitorIdList(monitor.controlDeviceIds);
  const accountId = monitor.accountId;

  const isPoll = request.nextUrl.searchParams.get("poll") === "1";
  if (isPoll) {
    const sinceScanId = Number(request.nextUrl.searchParams.get("since") ?? "0") || 0;
    const includeTickets = request.nextUrl.searchParams.get("tickets") !== "0";
    const scansOnly = request.nextUrl.searchParams.get("scansOnly") === "1";

    const data = await runPublicMonitorPoll(prisma, {
      accountId,
      deviceIds,
      areaIds,
      controlDeviceIds,
      monitorName: monitor.name,
      sinceScanId,
      includeTickets,
      scansOnly,
    });

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  return NextResponse.json(
    {
      error: "Bitte die Monitor-Seite neu laden (F5).",
      hint: "Live-Updates laufen über kurzes Polling (?poll=1), nicht mehr über Dauer-SSE.",
    },
    { status: 410 }
  );
}

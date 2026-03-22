import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runPublicMonitorPoll } from "@/lib/monitor-public-poll";

/** Kurze Requests – kein Dauer-SSE mehr (Vercel 10s-Limit + Neon-Reconnect-Sturm) */
export const maxDuration = 25;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
  });

  if (!monitor || !monitor.isActive) {
    return new Response("Monitor nicht gefunden oder inaktiv", { status: 404 });
  }

  const deviceIds = (monitor.deviceIds as number[]) ?? [];
  const accountId = monitor.accountId;

  const isPoll = request.nextUrl.searchParams.get("poll") === "1";
  if (isPoll) {
    const sinceScanId = Number(request.nextUrl.searchParams.get("since") ?? "0") || 0;
    const includeTickets = request.nextUrl.searchParams.get("tickets") !== "0";

    const data = await runPublicMonitorPoll(prisma, {
      accountId,
      deviceIds,
      monitorName: monitor.name,
      sinceScanId,
      includeTickets,
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

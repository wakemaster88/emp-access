import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadServiceSlots } from "@/lib/service-slots";

export const maxDuration = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Holt fuer einen Service an einem konkreten Datum die buchbaren Slots aus
 * ANNY. Die Logik steht in `loadServiceSlots` (src/lib/service-slots.ts),
 * damit das Vereinsportal dieselben Slots sieht.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const serviceIdRaw = request.nextUrl.searchParams.get("serviceId");
  const dateStr = request.nextUrl.searchParams.get("date") ?? "";
  const serviceId = Number(serviceIdRaw);
  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return NextResponse.json({ error: "Ungueltige serviceId" }, { status: 400 });
  }
  if (!DATE_RE.test(dateStr)) {
    return NextResponse.json({ error: "Ungueltiges Datum (YYYY-MM-DD)" }, { status: 400 });
  }

  const result = await loadServiceSlots(monitor.accountId, serviceId, dateStr, {
    debug: request.nextUrl.searchParams.get("debug") === "1",
  });
  return NextResponse.json(result.body, { status: result.status });
}

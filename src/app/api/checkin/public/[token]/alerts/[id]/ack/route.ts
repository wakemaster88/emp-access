import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 10;

/** Quittiert eine Warnung — danach ist sie auf allen Monitoren weg. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const alertId = Number(id);
  if (!Number.isInteger(alertId) || alertId <= 0) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  // accountId mit in die Bedingung: Ein Token darf nur die eigenen Alarme
  // schliessen, auch wenn jemand eine fremde ID raet.
  const result = await prisma.monitorAlert.updateMany({
    where: {
      id: alertId,
      accountId: monitor.accountId,
      acknowledgedAt: null,
    },
    data: { acknowledgedAt: new Date() },
  });

  return NextResponse.json({ ok: true, updated: result.count });
}

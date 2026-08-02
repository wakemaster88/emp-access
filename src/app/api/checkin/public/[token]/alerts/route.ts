import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 10;

/**
 * Offene Warnungen fuer den Kassen-/Check-in-Monitor.
 *
 * Eigener, sehr kleiner Endpunkt statt eines Felds im grossen Check-in-Poll:
 * Der laeuft alle acht Sekunden und haengt an einem Edge-Cache. Ein Alarm
 * soll schneller ankommen, und ein paar Zeilen JSON kosten nichts.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  // Alte Vorfaelle nicht mehr aufpoppen lassen: Wer nachts das Fenster neu
  // laedt, soll nicht den Alarm von vorgestern quittieren muessen.
  const since = new Date(Date.now() - 6 * 3600_000);

  const alerts = await prisma.monitorAlert.findMany({
    where: {
      accountId: monitor.accountId,
      acknowledgedAt: null,
      createdAt: { gte: since },
    },
    orderBy: { occurredAt: "desc" },
    take: 10,
    select: {
      id: true,
      kind: true,
      message: true,
      source: true,
      occurredAt: true,
      // Nur die Kennung, nicht die Bytes — die holt der Monitor als Bild-URL
      // nach und darf sie dann auch cachen.
      images: {
        select: { position: true, label: true },
        orderBy: { position: "asc" },
      },
    },
  });

  return NextResponse.json(
    { alerts },
    { headers: { "Cache-Control": "no-store" } },
  );
}

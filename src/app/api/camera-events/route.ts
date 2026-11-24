import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { recentActivityWhere } from "@/lib/camera-events";

/**
 * GET (Session): letzte Kamera-Ereignisse fürs Kontrollzentrum-Overlay.
 * Liefert Ereignisse der letzten 15 Minuten plus alle noch laufenden. Als
 * laufend gilt ein offenes Ereignis höchstens 24 Stunden: Ein Ereignis, dessen
 * Ende verloren ging, blinkte sonst für immer auf der Kachel.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const minutes = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get("minutes")) || 15));
  const now = new Date();
  const since = new Date(now.getTime() - minutes * 60_000);

  const events = await db.cameraEvent.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      ...recentActivityWhere(since, now),
    },
    orderBy: { startedAt: "desc" },
    take: 100,
    select: {
      id: true,
      cameraId: true,
      type: true,
      startedAt: true,
      endedAt: true,
    },
  });

  return NextResponse.json(
    events.map((e) => ({
      id: e.id,
      cameraId: e.cameraId,
      type: e.type,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt?.toISOString() ?? null,
    }))
  );
}

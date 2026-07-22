import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * GET (Session): letzte Kamera-Ereignisse fürs Kontrollzentrum-Overlay.
 * Liefert Ereignisse der letzten 15 Minuten plus alle noch laufenden.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const minutes = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get("minutes")) || 15));
  const since = new Date(Date.now() - minutes * 60_000);

  const events = await db.cameraEvent.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      OR: [{ startedAt: { gte: since } }, { endedAt: null }],
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

import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { readMowerState } from "@/lib/mower";

/**
 * GET (Session): aktueller Zustand aller Maeher des Mandanten, ohne Karte.
 * Das Maeher-Widget im Raum fragt hier alle 30 s nach.
 */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (!accountId) return NextResponse.json({ mowers: [] });

  const devices = await db.device.findMany({
    where: { accountId, type: "MAMMOTION_MOWER" },
    select: { id: true, systemInfo: true, lastUpdate: true },
  });
  return NextResponse.json(
    {
      mowers: devices.map((d) => ({
        id: d.id,
        state: readMowerState(d.systemInfo),
        lastUpdate: d.lastUpdate ? d.lastUpdate.toISOString() : null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

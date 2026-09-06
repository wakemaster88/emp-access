import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { doorHoldState } from "@/lib/door-hold";

/**
 * GET (Session): Offenhalte-Zustand aller DoorBird-Türstationen fuer das
 * Kontrollzentrum (wird dort alle paar Sekunden gepollt, solange eine
 * DoorBird angezeigt wird).
 */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const cameras = await session.db.camera.findMany({
    where: { accountId: session.accountId!, kind: "DOORBIRD" },
    select: {
      id: true,
      doorHoldUntil: true,
      doorHoldPulseAt: true,
      doorHoldError: true,
    },
  });
  return NextResponse.json(
    cameras.map((c) => ({ cameraId: c.id, ...doorHoldState(c) }))
  );
}

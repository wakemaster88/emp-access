import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { parseParkingSnapshot } from "@/lib/parking";

/** GET (Session): Hub-Parkplatzstatus + Kameras zum Zuordnen der Zonen. */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const [cameras, hubAgents] = await Promise.all([
    db.camera.findMany({
      where: { accountId: accountId! },
      select: {
        id: true,
        name: true,
        kind: true,
        host: true,
        snapshotAt: true,
        lastSeenAt: true,
      },
      orderBy: { name: "asc" },
    }),
    db.hubAgent.findMany({
      where: { accountId: accountId! },
      select: { name: true, lastSeenAt: true, status: true },
      orderBy: { lastSeenAt: "desc" },
    }),
  ]);

  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const liveHub =
    hubAgents.find((h) => h.lastSeenAt && h.lastSeenAt > fiveMinAgo) ?? hubAgents[0] ?? null;
  const hubOnline = !!(liveHub?.lastSeenAt && liveHub.lastSeenAt > fiveMinAgo);

  return NextResponse.json({
    hubOnline,
    hubName: liveHub?.name ?? null,
    parking: parseParkingSnapshot(liveHub?.status),
    cameras: cameras.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      host: c.host,
      snapshotAt: c.snapshotAt?.toISOString() ?? null,
      lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    })),
  });
}

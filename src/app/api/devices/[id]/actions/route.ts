import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/** So viele Eintraege liefert die Liste „Letzte Schaltungen“. */
const LIMIT = 50;

/**
 * GET: die letzten Eintraege aus dem Geraete-Protokoll (DeviceActionLog),
 * neueste zuerst. Auch fuer bereits geloeschte Geraete abrufbar, solange die
 * Eintraege noch nicht abgelaufen sind.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) {
    return NextResponse.json({ error: "Kein Mandant gewählt" }, { status: 400 });
  }
  const deviceId = Number((await params).id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const rows = await db.deviceActionLog.findMany({
    where: { accountId, deviceId },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      action: true,
      result: true,
      source: true,
      actorId: true,
      actorLabel: true,
      deviceName: true,
      createdAt: true,
    },
  });

  // Namen der Benutzer, die von Hand geschaltet haben.
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is number => id != null))];
  const admins = actorIds.length
    ? await db.admin.findMany({ where: { id: { in: actorIds }, accountId }, select: { id: true, name: true } })
    : [];
  const names = new Map(admins.map((a) => [a.id, a.name]));

  return NextResponse.json({
    actions: rows.map((r) => ({
      ...r,
      actorName: r.actorId != null ? (names.get(r.actorId) ?? null) : null,
    })),
  });
}

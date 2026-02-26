import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (isNaN(ticketId)) return NextResponse.json([], { status: 400 });

  const { db, accountId } = session;

  const scans = await db.scan.findMany({
    where: { ticketId, accountId: accountId! },
    include: { device: { select: { name: true } } },
    orderBy: { scanTime: "desc" },
    take: 100,
  });

  return NextResponse.json(scans);
}

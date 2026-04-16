import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const automation = await db.shellyAutomation.findFirst({
    where: { id: Number(id), accountId: accountId! },
    select: { id: true },
  });
  if (!automation) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || "50"), 200);
  const runs = await db.shellyAutomationRun.findMany({
    where: { automationId: Number(id), accountId: accountId! },
    orderBy: { triggeredAt: "desc" },
    take: limit,
  });
  return NextResponse.json(runs);
}

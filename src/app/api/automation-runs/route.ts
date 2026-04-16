import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || "100"), 500);

  const runs = await db.shellyAutomationRun.findMany({
    where: { accountId: accountId! },
    orderBy: { triggeredAt: "desc" },
    take: limit,
    include: {
      automation: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(runs);
}

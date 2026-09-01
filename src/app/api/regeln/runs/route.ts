import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number(params.get("limit") || "100"), 500);
  const ruleId = params.get("ruleId");
  const roomId = params.get("roomId");

  const runs = await db.roomRuleRun.findMany({
    where: {
      accountId: accountId!,
      ...(ruleId ? { ruleId: Number(ruleId) } : {}),
      ...(roomId ? { roomId: Number(roomId) } : {}),
    },
    orderBy: { triggeredAt: "desc" },
    take: limit,
  });
  return NextResponse.json(runs);
}

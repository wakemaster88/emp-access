import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { executeGroup } from "@/lib/shelly-automation";

export const maxDuration = 30;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const automation = await db.shellyAutomation.findFirst({
    where: { id: Number(id), accountId: accountId! },
    select: { groupId: true },
  });
  if (!automation) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const result = await executeGroup(automation.groupId, accountId!, "manual", Number(id));
  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}

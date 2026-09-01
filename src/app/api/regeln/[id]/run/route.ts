import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { executeRule } from "@/lib/room-rules";

export const maxDuration = 30;

/**
 * Regel von Hand ausloesen. Umgeht bewusst die Bedingungen und die Sperrzeit:
 * wer hier drueckt, will genau jetzt sehen, ob die Aktionen greifen.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const ruleId = Number((await params).id);
  if (isNaN(ruleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const rule = await db.roomRule.findFirst({
    where: { id: ruleId, accountId: accountId! },
    select: { id: true },
  });
  if (!rule) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const result = await executeRule(ruleId, "manual");
  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}

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

  const group = await db.shellyGroup.findFirst({
    where: { id: Number(id), accountId: accountId! },
    select: { id: true },
  });
  if (!group) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const result = await executeGroup(Number(id), accountId!, "manual", null);
  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}

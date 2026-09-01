import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { createHolder } from "@/lib/key-holders";
import { holderInclude } from "@/lib/keying-queries";
import { keyHolderCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const holders = await db.keyHolder.findMany({
    where: { accountId: accountId! },
    include: holderInclude,
    orderBy: [{ lastName: "asc" }, { company: "asc" }],
  });
  return NextResponse.json(holders);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyHolderCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const result = await createHolder(db, accountId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });

  const holder = await db.keyHolder.findUnique({
    where: { id: result.holderId },
    include: holderInclude,
  });
  return NextResponse.json(holder, { status: 201 });
}

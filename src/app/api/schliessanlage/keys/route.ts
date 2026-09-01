import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { keyItemInclude } from "@/lib/keying-queries";
import { keyItemCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const keys = await db.keyItem.findMany({
    where: { accountId: accountId! },
    include: keyItemInclude,
    orderBy: [{ keyNumber: "asc" }],
  });
  return NextResponse.json(keys);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyItemCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const lockIds = data.lockIds ?? [];
  if (lockIds.length > 0) {
    const found = await db.keyLock.count({ where: { id: { in: lockIds }, accountId } });
    if (found !== lockIds.length) {
      return NextResponse.json({ error: "Unbekanntes Schloss ausgewählt" }, { status: 400 });
    }
  }

  try {
    const key = await db.keyItem.create({
      data: {
        accountId,
        keyNumber: data.keyNumber.trim(),
        label: data.label?.trim() || null,
        level: data.level ?? "SINGLE",
        status: data.status ?? "AVAILABLE",
        notes: data.notes?.trim() || null,
        locks: { create: lockIds.map((lockId) => ({ lockId })) },
      },
      include: keyItemInclude,
    });
    return NextResponse.json(key, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Diese Schlüsselnummer ist bereits vergeben" },
        { status: 409 },
      );
    }
    throw e;
  }
}

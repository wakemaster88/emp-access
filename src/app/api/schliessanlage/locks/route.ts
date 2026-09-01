import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockWithPathInclude } from "@/lib/keying-queries";
import { keyLockCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const locks = await db.keyLock.findMany({
    where: { accountId: accountId! },
    include: lockWithPathInclude,
    orderBy: [{ doorId: "asc" }, { id: "asc" }],
  });
  return NextResponse.json(locks);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyLockCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const door = await db.keyDoor.findFirst({ where: { id: data.doorId, accountId } });
  if (!door) return NextResponse.json({ error: "Tür nicht gefunden" }, { status: 400 });

  const lock = await db.keyLock.create({
    data: {
      accountId,
      doorId: data.doorId,
      lockNumber: data.lockNumber?.trim() || null,
      lockType: data.lockType ?? "CYLINDER",
      system: data.system?.trim() || null,
      manufacturer: data.manufacturer?.trim() || null,
      installedAt: data.installedAt ? new Date(data.installedAt) : null,
      notes: data.notes?.trim() || null,
    },
    include: lockWithPathInclude,
  });
  return NextResponse.json(lock, { status: 201 });
}

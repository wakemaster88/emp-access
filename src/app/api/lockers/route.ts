import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockerCreateSchema } from "@/lib/validators";

const lockerInclude = {
  subscription: { select: { id: true, name: true } },
} as const;

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const lockers = await db.locker.findMany({
    where: { accountId: accountId! },
    include: lockerInclude,
    orderBy: [{ location: "asc" }, { number: "asc" }],
  });
  return NextResponse.json(lockers);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const parsed = lockerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  // Tenant-Check für Subscription, falls gesetzt.
  let subscriptionId: number | null = null;
  if (data.subscriptionId) {
    const sub = await db.subscription.findFirst({
      where: { id: data.subscriptionId, accountId: accountId! },
      select: { id: true },
    });
    if (!sub) {
      return NextResponse.json({ error: "Abo nicht gefunden" }, { status: 400 });
    }
    subscriptionId = sub.id;
  }

  try {
    const locker = await db.locker.create({
      data: {
        name: data.name.trim(),
        number: data.number.trim(),
        location: data.location?.trim() || null,
        notes: data.notes?.trim() || null,
        subscriptionId,
        accountId: accountId!,
      },
      include: lockerInclude,
    });
    return NextResponse.json(locker, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Ein Schließfach mit dieser Nummer existiert bereits" }, { status: 409 });
    }
    throw e;
  }
}

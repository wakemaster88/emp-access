import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockerCreateSchema } from "@/lib/validators";

const lockerInclude = {
  ticket: {
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      ticketTypeName: true,
      subscription: { select: { id: true, name: true } },
    },
  },
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

  // Tenant-Check für Ticket, falls gesetzt.
  let ticketId: number | null = null;
  if (data.ticketId) {
    const ticket = await db.ticket.findFirst({
      where: { id: data.ticketId, accountId: accountId! },
      select: { id: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 400 });
    }
    ticketId = ticket.id;
  }

  try {
    const locker = await db.locker.create({
      data: {
        name: data.name.trim(),
        number: data.number.trim(),
        location: data.location?.trim() || null,
        notes: data.notes?.trim() || null,
        ticketId,
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

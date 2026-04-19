import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockerCreateSchema } from "@/lib/validators";

const rentalTicketSelect = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  ticketTypeName: true,
  status: true,
  endDate: true,
  subscription: { select: { id: true, name: true } },
} as const;

const lockerInclude = {
  rentals: {
    include: { ticket: { select: rentalTicketSelect } },
    orderBy: { year: "desc" as const },
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

  // Tenant-Check für initial-Rental, falls gesetzt.
  if (data.initialRental) {
    const ticket = await db.ticket.findFirst({
      where: { id: data.initialRental.ticketId, accountId: accountId! },
      select: { id: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 400 });
    }
  }

  try {
    const locker = await db.locker.create({
      data: {
        name: data.name.trim(),
        number: data.number.trim(),
        location: data.location?.trim() || null,
        notes: data.notes?.trim() || null,
        ...(data.lockType !== undefined && { lockType: data.lockType }),
        ...(data.keyCount !== undefined && { keyCount: data.keyCount }),
        ...(data.lockNumber !== undefined && { lockNumber: data.lockNumber?.trim() || null }),
        accountId: accountId!,
        ...(data.initialRental && {
          rentals: {
            create: {
              year: data.initialRental.year,
              ticketId: data.initialRental.ticketId,
              notes: data.initialRental.notes?.trim() || null,
            },
          },
        }),
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

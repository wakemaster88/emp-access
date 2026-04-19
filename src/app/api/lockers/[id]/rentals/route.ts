import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockerRentalCreateSchema } from "@/lib/validators";

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const lockerId = Number(id);
  if (isNaN(lockerId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const locker = await db.locker.findFirst({
    where: { id: lockerId, accountId: accountId! },
    select: { id: true },
  });
  if (!locker) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const rentals = await db.lockerRental.findMany({
    where: { lockerId },
    include: { ticket: { select: rentalTicketSelect } },
    orderBy: { year: "desc" },
  });
  return NextResponse.json(rentals);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const lockerId = Number(id);
  if (isNaN(lockerId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = lockerRentalCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  // Tenant-Check Locker und Ticket parallel.
  const [locker, ticket] = await Promise.all([
    db.locker.findFirst({ where: { id: lockerId, accountId: accountId! }, select: { id: true } }),
    db.ticket.findFirst({ where: { id: data.ticketId, accountId: accountId! }, select: { id: true } }),
  ]);
  if (!locker) return NextResponse.json({ error: "Schließfach nicht gefunden" }, { status: 404 });
  if (!ticket) return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 400 });

  try {
    const rental = await db.lockerRental.create({
      data: {
        lockerId,
        ticketId: data.ticketId,
        year: data.year,
        notes: data.notes?.trim() || null,
        ...(data.keysIssued !== undefined && { keysIssued: data.keysIssued }),
        ...(data.keysReturned !== undefined && { keysReturned: data.keysReturned }),
        ...(data.issuedAt !== undefined && { issuedAt: data.issuedAt ? new Date(data.issuedAt) : null }),
        ...(data.returnedAt !== undefined && { returnedAt: data.returnedAt ? new Date(data.returnedAt) : null }),
      },
      include: { ticket: { select: rentalTicketSelect } },
    });
    return NextResponse.json(rental, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: `Für ${data.year} ist bereits eine Vermietung hinterlegt` },
        { status: 409 }
      );
    }
    throw e;
  }
}

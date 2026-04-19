import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockerRentalUpdateSchema } from "@/lib/validators";

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rentalId: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id, rentalId: rentalIdRaw } = await params;
  const lockerId = Number(id);
  const rentalId = Number(rentalIdRaw);
  if (isNaN(lockerId) || isNaN(rentalId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = lockerRentalUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const existing = await db.lockerRental.findFirst({
    where: { id: rentalId, lockerId, locker: { accountId: accountId! } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Wenn ein neues Ticket gesetzt wird → Tenant-Check.
  if (data.ticketId !== undefined) {
    const ticket = await db.ticket.findFirst({
      where: { id: data.ticketId, accountId: accountId! },
      select: { id: true },
    });
    if (!ticket) return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 400 });
  }

  try {
    const rental = await db.lockerRental.update({
      where: { id: rentalId },
      data: {
        ...(data.year !== undefined && { year: data.year }),
        ...(data.ticketId !== undefined && { ticketId: data.ticketId }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        ...(data.keysIssued !== undefined && { keysIssued: data.keysIssued }),
        ...(data.keysReturned !== undefined && { keysReturned: data.keysReturned }),
        ...(data.issuedAt !== undefined && { issuedAt: data.issuedAt ? new Date(data.issuedAt) : null }),
        ...(data.returnedAt !== undefined && { returnedAt: data.returnedAt ? new Date(data.returnedAt) : null }),
      },
      include: { ticket: { select: rentalTicketSelect } },
    });
    return NextResponse.json(rental);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Für dieses Jahr ist bereits eine Vermietung hinterlegt" },
        { status: 409 }
      );
    }
    throw e;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rentalId: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id, rentalId: rentalIdRaw } = await params;
  const lockerId = Number(id);
  const rentalId = Number(rentalIdRaw);
  if (isNaN(lockerId) || isNaN(rentalId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.lockerRental.findFirst({
    where: { id: rentalId, lockerId, locker: { accountId: accountId! } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.lockerRental.delete({ where: { id: rentalId } });
  return NextResponse.json({ ok: true });
}

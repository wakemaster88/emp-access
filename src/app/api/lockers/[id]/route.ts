import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lockerUpdateSchema } from "@/lib/validators";

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
    include: lockerInclude,
  });
  if (!locker) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(locker);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const lockerId = Number(id);
  if (isNaN(lockerId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = lockerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const existing = await db.locker.findFirst({
    where: { id: lockerId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Tenant-Check für Ticket, falls explizit gesetzt.
  let ticketUpdate: { ticketId?: number | null } = {};
  if (data.ticketId !== undefined) {
    if (data.ticketId === null) {
      ticketUpdate = { ticketId: null };
    } else {
      const ticket = await db.ticket.findFirst({
        where: { id: data.ticketId, accountId: accountId! },
        select: { id: true },
      });
      if (!ticket) return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 400 });
      ticketUpdate = { ticketId: ticket.id };
    }
  }

  try {
    const locker = await db.locker.update({
      where: { id: lockerId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.number !== undefined && { number: data.number.trim() }),
        ...(data.location !== undefined && { location: data.location?.trim() || null }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        ...ticketUpdate,
      },
      include: lockerInclude,
    });
    return NextResponse.json(locker);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Ein Schließfach mit dieser Nummer existiert bereits" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const lockerId = Number(id);
  if (isNaN(lockerId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.locker.findFirst({
    where: { id: lockerId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.locker.delete({ where: { id: lockerId } });
  return NextResponse.json({ ok: true });
}

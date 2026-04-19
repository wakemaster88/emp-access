import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { vereinUpdateSchema } from "@/lib/validators";

const accessTicketInclude = {
  ticket: {
    select: {
      id: true,
      name: true,
      ticketTypeName: true,
      accessAreaId: true,
      accessArea: { select: { id: true, name: true } },
      ticketAreas: { select: { accessArea: { select: { id: true, name: true } } } },
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
  const vereinId = Number(id);
  if (isNaN(vereinId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const verein = await db.verein.findFirst({
    where: { id: vereinId, accountId: accountId! },
    include: {
      accessTickets: { include: accessTicketInclude },
      members: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          status: true,
          ticketTypeName: true,
          rfidCode: true,
          barcode: true,
          startDate: true,
          endDate: true,
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      },
      _count: { select: { members: true } },
    },
  });
  if (!verein) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(verein);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const vereinId = Number(id);
  if (isNaN(vereinId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = vereinUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const existing = await db.verein.findFirst({
    where: { id: vereinId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  try {
    if (data.accessTickets !== undefined) {
      // Komplett ersetzen: erst alle löschen, dann neu anlegen.
      await db.vereinAccessTicket.deleteMany({ where: { vereinId } });
      if (data.accessTickets.length > 0) {
        const validTickets = await db.ticket.findMany({
          where: { id: { in: data.accessTickets.map((a) => a.ticketId) }, accountId: accountId! },
          select: { id: true },
        });
        const validIds = new Set(validTickets.map((t) => t.id));
        const rows = data.accessTickets
          .filter((a) => validIds.has(a.ticketId))
          .map((a) => ({
            vereinId,
            ticketId: a.ticketId,
            daysOfWeek: a.daysOfWeek ?? 127,
            slotStart: a.slotStart ?? null,
            slotEnd: a.slotEnd ?? null,
          }));
        if (rows.length > 0) {
          await db.vereinAccessTicket.createMany({ data: rows });
        }
      }
    }

    if (data.memberTicketIds !== undefined) {
      // Erst alle bestehenden Mitglieder lösen, dann neue setzen.
      await db.ticket.updateMany({
        where: { vereinId, accountId: accountId! },
        data: { vereinId: null },
      });
      if (data.memberTicketIds.length > 0) {
        await db.ticket.updateMany({
          where: { id: { in: data.memberTicketIds }, accountId: accountId! },
          data: { vereinId },
        });
      }
    }

    const verein = await db.verein.update({
      where: { id: vereinId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description }),
      },
      include: {
        accessTickets: { include: accessTicketInclude },
        _count: { select: { members: true } },
      },
    });
    return NextResponse.json(verein);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Ein Verein mit diesem Namen existiert bereits" }, { status: 409 });
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
  const vereinId = Number(id);
  if (isNaN(vereinId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.verein.findFirst({
    where: { id: vereinId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.verein.delete({ where: { id: vereinId } });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { vereinCreateSchema } from "@/lib/validators";

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

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const vereine = await db.verein.findMany({
    where: { accountId: accountId! },
    include: {
      accessTickets: { include: accessTicketInclude },
      _count: { select: { members: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(vereine);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const parsed = vereinCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;
  const accessTickets = data.accessTickets ?? [];
  const memberIds = data.memberTicketIds ?? [];

  try {
    // Tenant-Check für Ticket-IDs.
    const validIds = new Set(
      accessTickets.length > 0
        ? (await db.ticket.findMany({
            where: { id: { in: accessTickets.map((a) => a.ticketId) }, accountId: accountId! },
            select: { id: true },
          })).map((t) => t.id)
        : []
    );
    const safeAccess = accessTickets.filter((a) => validIds.has(a.ticketId));

    const verein = await db.verein.create({
      data: {
        name: data.name.trim(),
        description: data.description ?? null,
        accountId: accountId!,
        ...(safeAccess.length > 0 && {
          accessTickets: {
            create: safeAccess.map((a) => ({
              ticketId: a.ticketId,
              daysOfWeek: a.daysOfWeek ?? 127,
              slotStart: a.slotStart ?? null,
              slotEnd: a.slotEnd ?? null,
            })),
          },
        }),
        ...(memberIds.length > 0 && {
          members: { connect: memberIds.map((id) => ({ id })) },
        }),
      },
      include: {
        accessTickets: { include: accessTicketInclude },
        _count: { select: { members: true } },
      },
    });
    return NextResponse.json(verein, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Ein Verein mit diesem Namen existiert bereits" }, { status: 409 });
    }
    throw e;
  }
}

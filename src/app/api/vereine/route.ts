import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { vereinCreateSchema } from "@/lib/validators";

const accessTicketInclude = {
  ticket: {
    select: {
      id: true,
      name: true,
      ticketTypeName: true,
      validityType: true,
      slotStart: true,
      slotEnd: true,
      startDate: true,
      endDate: true,
      validityDurationMinutes: true,
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
  const accessTicketIds = data.accessTicketIds ?? [];
  const memberIds = data.memberTicketIds ?? [];

  try {
    const validIds = accessTicketIds.length > 0
      ? (await db.ticket.findMany({
          where: { id: { in: accessTicketIds }, accountId: accountId! },
          select: { id: true },
        })).map((t) => t.id)
      : [];

    const verein = await db.verein.create({
      data: {
        name: data.name.trim(),
        description: data.description ?? null,
        accountId: accountId!,
        ...(validIds.length > 0 && {
          accessTickets: {
            create: validIds.map((ticketId) => ({ ticketId })),
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

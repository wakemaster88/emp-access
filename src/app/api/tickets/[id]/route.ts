import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { ticketCreateSchema } from "@/lib/validators";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (isNaN(ticketId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, accountId: accountId! },
    include: { _count: { select: { scans: true } } },
  });
  if (!ticket) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(ticket);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (isNaN(ticketId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = ticketCreateSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const existing = await db.ticket.findFirst({
    where: { id: ticketId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const ticket = await db.ticket.update({
    where: { id: ticketId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.ticketTypeName !== undefined && { ticketTypeName: data.ticketTypeName }),
      ...(data.barcode !== undefined && { barcode: data.barcode }),
      ...(data.qrCode !== undefined && { qrCode: data.qrCode }),
      ...(data.rfidCode !== undefined && { rfidCode: data.rfidCode }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.accessAreaId !== undefined && { accessAreaId: data.accessAreaId }),
      ...(data.subscriptionId !== undefined && { subscriptionId: data.subscriptionId }),
      ...(data.validityType !== undefined && { validityType: data.validityType }),
      ...(data.slotStart !== undefined && { slotStart: data.slotStart }),
      ...(data.slotEnd !== undefined && { slotEnd: data.slotEnd }),
      ...(data.validityDurationMinutes !== undefined && { validityDurationMinutes: data.validityDurationMinutes }),
      ...(data.profileImage !== undefined && { profileImage: data.profileImage }),
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      version: { increment: 1 },
    },
  });

  return NextResponse.json(ticket);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (isNaN(ticketId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.ticket.findFirst({
    where: { id: ticketId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.ticket.delete({ where: { id: ticketId } });

  return NextResponse.json({ ok: true });
}

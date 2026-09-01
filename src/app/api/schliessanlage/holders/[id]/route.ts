import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { holderInclude } from "@/lib/keying-queries";
import { keyHolderUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const holderId = Number((await params).id);
  if (isNaN(holderId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keyHolderUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.keyHolder.findFirst({ where: { id: holderId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  if (data.ticketId != null) {
    const ticket = await db.ticket.findFirst({
      where: { id: data.ticketId, accountId },
      select: { id: true },
    });
    if (!ticket) return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 400 });
  }

  const holder = await db.keyHolder.update({
    where: { id: holderId },
    data: {
      ...(data.ticketId !== undefined && { ticketId: data.ticketId ?? null }),
      ...(data.firstName !== undefined && { firstName: data.firstName?.trim() || null }),
      ...(data.lastName !== undefined && { lastName: data.lastName?.trim() || null }),
      ...(data.company !== undefined && { company: data.company?.trim() || null }),
      ...(data.email !== undefined && { email: data.email?.trim() || null }),
      ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
    include: holderInclude,
  });
  return NextResponse.json(holder);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const holderId = Number((await params).id);
  if (isNaN(holderId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.keyHolder.findFirst({
    where: { id: holderId, accountId },
    include: { _count: { select: { handovers: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Protokolle haengen per Cascade am Empfaenger – ein Nachweis darf nicht
  // versehentlich mitgeloescht werden.
  if (existing._count.handovers > 0) {
    return NextResponse.json(
      { error: "Empfänger hat Protokolleinträge und kann nicht gelöscht werden" },
      { status: 409 },
    );
  }

  await db.keyHolder.delete({ where: { id: holderId } });
  return NextResponse.json({ ok: true });
}

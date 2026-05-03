import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const ticketId = Number(body.ticketId);
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  if (body.profileImage !== undefined) {
    updateData.profileImage = body.profileImage || null;
  }

  if (body.rfidCode !== undefined) {
    const rfid = (body.rfidCode as string)?.trim() || null;

    if (rfid) {
      const existing = await prisma.ticket.findFirst({
        where: {
          rfidCode: rfid,
          accountId: monitor.accountId,
          id: { not: ticket.id },
        },
        select: { id: true, name: true, firstName: true, lastName: true, ticketTypeName: true },
      });

      if (existing && !body.force) {
        const ownerName = [existing.firstName, existing.lastName].filter(Boolean).join(" ") || existing.name;
        return NextResponse.json({
          conflict: true,
          existingTicketId: existing.id,
          existingOwner: ownerName,
          existingType: existing.ticketTypeName,
          message: `RFID ist bereits vergeben an ${ownerName}`,
        }, { status: 409 });
      }

      if (existing && body.force) {
        await prisma.ticket.update({
          where: { id: existing.id },
          data: { rfidCode: null, version: { increment: 1 } },
        });
      }
    }

    updateData.rfidCode = rfid;
  }

  if (body.startDate !== undefined) {
    updateData.startDate = body.startDate ? new Date(body.startDate) : null;
  }
  if (body.endDate !== undefined) {
    updateData.endDate = body.endDate ? new Date(body.endDate) : null;
  }

  if (body.firstName !== undefined) {
    const v = typeof body.firstName === "string" ? body.firstName.trim() : "";
    updateData.firstName = v || null;
  }
  if (body.lastName !== undefined) {
    const v = typeof body.lastName === "string" ? body.lastName.trim() : "";
    updateData.lastName = v || null;
  }
  if (body.birthDate !== undefined) {
    updateData.birthDate = body.birthDate ? new Date(body.birthDate) : null;
  }

  // Wenn Vor-/Nachname aktualisiert wurden, ziehen wir den `name`
  // automatisch nach. So bleibt das, was im Listing/Header angezeigt
  // wird, konsistent.
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const newFirst =
      body.firstName !== undefined
        ? (typeof body.firstName === "string" ? body.firstName.trim() : "")
        : ticket.firstName ?? "";
    const newLast =
      body.lastName !== undefined
        ? (typeof body.lastName === "string" ? body.lastName.trim() : "")
        : ticket.lastName ?? "";
    const fullName = `${newFirst} ${newLast}`.trim();
    if (fullName) {
      updateData.name = fullName;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Keine Änderungen" }, { status: 400 });
  }

  updateData.version = { increment: 1 };

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: updateData,
  });

  return NextResponse.json({
    success: true,
    ticket: {
      id: updated.id,
      name: updated.name,
      firstName: updated.firstName,
      lastName: updated.lastName,
      birthDate: updated.birthDate,
      profileImage: updated.profileImage,
      rfidCode: updated.rfidCode,
      startDate: updated.startDate,
      endDate: updated.endDate,
    },
  });
}

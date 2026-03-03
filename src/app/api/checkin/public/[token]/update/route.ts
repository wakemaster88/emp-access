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
    updateData.rfidCode = body.rfidCode || null;
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
      profileImage: updated.profileImage,
      rfidCode: updated.rfidCode,
    },
  });
}

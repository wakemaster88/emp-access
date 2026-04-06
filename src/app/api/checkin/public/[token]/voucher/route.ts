import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

export async function POST(
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

  if (ticket.status === "CANCELED" || ticket.status === "INVALID") {
    return NextResponse.json({ error: "Ticket bereits storniert" }, { status: 400 });
  }

  const code = `GS-${randomBytes(4).toString("hex").toUpperCase()}`;

  const [voucher] = await prisma.$transaction([
    prisma.voucher.create({
      data: {
        code,
        ticketTypeName: ticket.ticketTypeName,
        serviceId: ticket.serviceId,
        accessAreaId: ticket.accessAreaId,
        validityType: ticket.validityType,
        validityDurationMinutes: ticket.validityDurationMinutes,
        sourceTicketId: ticket.id,
        accountId: monitor.accountId,
      },
    }),
    prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "CANCELED", version: { increment: 1 } },
    }),
  ]);

  return NextResponse.json({
    success: true,
    voucher: {
      id: voucher.id,
      code: voucher.code,
      ticketTypeName: voucher.ticketTypeName,
    },
  });
}

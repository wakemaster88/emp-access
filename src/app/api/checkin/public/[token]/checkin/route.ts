import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  if (ticket.status === "INVALID") {
    return NextResponse.json({ success: false, message: "Ticket ungültig" });
  }

  if (ticket.status === "PROTECTED") {
    return NextResponse.json({ success: false, message: "Ticket gesperrt" });
  }

  const now = new Date();
  const code = ticket.barcode || ticket.qrCode || ticket.rfidCode || `checkin:${ticket.id}`;

  await prisma.scan.create({
    data: {
      code,
      result: "GRANTED",
      ticketId: ticket.id,
      accountId: monitor.accountId,
    },
  });

  const updateData: Record<string, unknown> = {};
  if (ticket.status === "VALID") {
    updateData.status = "REDEEMED";
  }
  if (ticket.validityType === "DURATION" && !ticket.firstScanAt) {
    updateData.firstScanAt = now;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
  }

  return NextResponse.json({
    success: true,
    message: "Eingecheckt",
    ticket: {
      id: ticket.id,
      name: ticket.name,
      status: updateData.status ?? ticket.status,
    },
  });
}

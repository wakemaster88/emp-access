import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive) {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
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
    return NextResponse.json({ granted: false, message: "Ticket ungültig" });
  }

  if (ticket.status === "PROTECTED") {
    return NextResponse.json({ granted: false, message: "Ticket gesperrt" });
  }

  const now = new Date();

  if (ticket.endDate && new Date(ticket.endDate) < now) {
    return NextResponse.json({ granted: false, message: "Ticket abgelaufen" });
  }
  if (ticket.startDate && new Date(ticket.startDate) > now) {
    return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig" });
  }

  const code = ticket.barcode || ticket.qrCode || ticket.rfidCode || `monitor:${ticket.id}`;

  const deviceIds = (monitor.deviceIds as number[]) ?? [];
  const deviceId = deviceIds.length > 0 ? deviceIds[0] : null;

  await prisma.scan.create({
    data: {
      code,
      result: "GRANTED",
      ticketId: ticket.id,
      accountId: monitor.accountId,
      ...(deviceId ? { deviceId } : {}),
    },
  });

  const updateData: Record<string, unknown> = {};
  if (ticket.validityType === "DURATION" && !ticket.firstScanAt) {
    updateData.firstScanAt = now;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
  }

  return NextResponse.json({
    granted: true,
    message: "Eingecheckt",
    ticket: {
      id: ticket.id,
      name: ticket.name,
      firstName: ticket.firstName,
      lastName: ticket.lastName,
    },
  });
}

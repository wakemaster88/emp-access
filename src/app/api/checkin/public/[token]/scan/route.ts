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
  const rawCode = String(body.code ?? "").trim();
  const code = rawCode.replace(/\s+/g, "");
  if (!code) {
    return NextResponse.json({ found: false, message: "Kein Code" });
  }

  const codesToTry = [code, rawCode];
  let ticket = null;
  for (const c of codesToTry) {
    ticket = await prisma.ticket.findFirst({
      where: {
        accountId: monitor.accountId,
        OR: [
          { qrCode: c },
          { rfidCode: c },
          { barcode: c },
          { uuid: c },
        ],
      },
      include: {
        accessArea: { select: { id: true, name: true } },
        subscription: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true } },
        service: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true } },
      },
    });
    if (ticket) break;
  }

  if (!ticket) {
    return NextResponse.json({ found: false, message: "Ticket nicht gefunden" });
  }

  return NextResponse.json({
    found: true,
    ticket: {
      id: ticket.id,
      name: ticket.name,
      firstName: ticket.firstName,
      lastName: ticket.lastName,
      ticketTypeName: ticket.ticketTypeName,
      status: ticket.status,
      validityType: ticket.validityType,
      slotStart: ticket.slotStart,
      slotEnd: ticket.slotEnd,
      validityDurationMinutes: ticket.validityDurationMinutes,
      firstScanAt: ticket.firstScanAt,
      startDate: ticket.startDate,
      endDate: ticket.endDate,
      profileImage: ticket.profileImage,
      rfidCode: ticket.rfidCode,
      extras: ticket.extras,
      source: ticket.source,
      accessArea: ticket.accessArea,
      subscription: ticket.subscription,
      service: ticket.service,
      checkedIn: ticket.status === "REDEEMED",
    },
  });
}

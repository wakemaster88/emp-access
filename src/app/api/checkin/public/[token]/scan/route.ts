import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { berlinOffset } from "@/lib/anny-availability";

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
    const candidates = await prisma.ticket.findMany({
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
    if (candidates.length > 0) {
      const now = new Date();
      function ticketScore(t: typeof candidates[0]): number {
        if (t.status === "INVALID" || t.status === "PROTECTED") return 0;
        const endOk = !t.endDate || new Date(new Date(t.endDate).setUTCHours(23, 59, 59, 999)) >= now;
        const startOk = !t.startDate || new Date(t.startDate) <= now;
        if (endOk && startOk && t.status === "VALID") return 4;
        if (endOk && startOk && t.status === "REDEEMED") return 3;
        if (endOk && startOk) return 2;
        return 1;
      }
      candidates.sort((a, b) => ticketScore(b) - ticketScore(a));
      ticket = candidates[0];
      break;
    }
  }

  if (!ticket) {
    // Gutschein-Einlösung: Code beginnt mit "GS-"
    if (code.startsWith("GS-")) {
      const voucher = await prisma.voucher.findUnique({
        where: { code, accountId: monitor.accountId },
      });
      if (voucher && !voucher.redeemedAt) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setUTCHours(23, 59, 59, 999);

        const newTicket = await prisma.ticket.create({
          data: {
            name: voucher.ticketTypeName ?? "Gutschein-Ticket",
            ticketTypeName: voucher.ticketTypeName,
            startDate: today,
            endDate: todayEnd,
            validityType: voucher.validityType,
            validityDurationMinutes: voucher.validityDurationMinutes,
            serviceId: voucher.serviceId,
            accessAreaId: voucher.accessAreaId,
            status: "VALID",
            accountId: monitor.accountId,
          },
          include: {
            accessArea: { select: { id: true, name: true } },
            subscription: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true } },
            service: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true } },
          },
        });

        await prisma.voucher.update({
          where: { id: voucher.id },
          data: { redeemedAt: new Date(), redeemedTicketId: newTicket.id },
        });

        return NextResponse.json({
          found: true,
          voucherRedeemed: true,
          message: "Gutschein eingelöst",
          ticket: {
            id: newTicket.id,
            name: newTicket.name,
            firstName: newTicket.firstName,
            lastName: newTicket.lastName,
            ticketTypeName: newTicket.ticketTypeName,
            status: newTicket.status,
            validityType: newTicket.validityType,
            slotStart: newTicket.slotStart,
            slotEnd: newTicket.slotEnd,
            validityDurationMinutes: newTicket.validityDurationMinutes,
            firstScanAt: newTicket.firstScanAt,
            startDate: newTicket.startDate,
            endDate: newTicket.endDate,
            profileImage: newTicket.profileImage,
            rfidCode: newTicket.rfidCode,
            extras: newTicket.extras,
            source: newTicket.source,
            subscriptionId: newTicket.subscriptionId,
            accessArea: newTicket.accessArea,
            subscription: newTicket.subscription,
            service: newTicket.service,
            checkedIn: false,
          },
        });
      }

      if (voucher?.redeemedAt) {
        return NextResponse.json({ found: false, message: "Gutschein bereits eingelöst" });
      }
    }

    return NextResponse.json({ found: false, message: "Ticket nicht gefunden" });
  }

  let checkedIn = ticket.status === "REDEEMED";
  if (ticket.subscriptionId != null) {
    const berlinDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const tz = berlinOffset(berlinDate);
    const dayStart = new Date(`${berlinDate}T00:00:00${tz}`);
    const dayEnd = new Date(`${berlinDate}T23:59:59${tz}`);
    const scanToday = await prisma.scan.findFirst({
      where: {
        ticketId: ticket.id,
        accountId: monitor.accountId,
        result: "GRANTED",
        scanTime: { gte: dayStart, lte: dayEnd },
      },
    });
    checkedIn = !!scanToday;
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
      subscriptionId: ticket.subscriptionId,
      accessArea: ticket.accessArea,
      subscription: ticket.subscription,
      service: ticket.service,
      checkedIn,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();
  const rawCode = String(body.code ?? "").trim();
  const code = rawCode.replace(/\s+/g, "");
  const accessAreaId = body.accessAreaId ? Number(body.accessAreaId) : undefined;

  if (!code) {
    return NextResponse.json({ granted: false, message: "Kein Code erkannt" });
  }

  const codesToTry = [code, rawCode];
  let ticket = null;
  for (const c of codesToTry) {
    const candidates = await db.ticket.findMany({
      where: {
        accountId: accountId!,
        OR: [
          { qrCode: c },
          { rfidCode: c },
          { barcode: c },
          { uuid: c },
        ],
      },
      include: {
        service: { select: { allowReentry: true, name: true } },
        subscription: { select: { name: true } },
        accessArea: { select: { name: true } },
        ticketAreas: { select: { accessAreaId: true } },
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
      const voucher = await db.voucher.findUnique({ where: { code, accountId: accountId! } });
      if (voucher && !voucher.redeemedAt) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setUTCHours(23, 59, 59, 999);

        const newTicket = await db.ticket.create({
          data: {
            name: voucher.ticketTypeName ?? "Gutschein-Ticket",
            ticketTypeName: voucher.ticketTypeName,
            startDate: today,
            endDate: todayEnd,
            validityType: voucher.validityType,
            validityDurationMinutes: voucher.validityDurationMinutes,
            serviceId: voucher.serviceId,
            accessAreaId: voucher.accessAreaId,
            status: "REDEEMED",
            accountId: accountId!,
          },
        });

        await db.voucher.update({
          where: { id: voucher.id },
          data: { redeemedAt: new Date(), redeemedTicketId: newTicket.id },
        });

        await db.scan.create({
          data: { code, result: "GRANTED", ticketId: newTicket.id, accountId: accountId! },
        });

        return NextResponse.json({
          granted: true,
          message: "Gutschein eingelöst",
          ticket: {
            name: newTicket.name,
            firstName: null,
            lastName: null,
            ticketTypeName: newTicket.ticketTypeName,
            status: newTicket.status,
            areaName: null,
            serviceName: null,
            subscriptionName: null,
          },
        });
      }

      if (voucher?.redeemedAt) {
        await db.scan.create({
          data: { code, result: "DENIED", accountId: accountId! },
        });
        return NextResponse.json({ granted: false, message: "Gutschein bereits eingelöst" });
      }
    }

    await db.scan.create({
      data: { code, result: "DENIED", accountId: accountId! },
    });
    return NextResponse.json({
      granted: false,
      message: "Ticket nicht gefunden",
    });
  }

  const ticketInfo = {
    name: ticket.name,
    firstName: ticket.firstName,
    lastName: ticket.lastName,
    ticketTypeName: ticket.ticketTypeName,
    status: ticket.status,
    areaName: ticket.accessArea?.name ?? null,
    serviceName: ticket.service?.name ?? null,
    subscriptionName: ticket.subscription?.name ?? null,
  };

  if (ticket.status === "INVALID") {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({ granted: false, message: "Ticket ungültig", ticket: ticketInfo });
  }

  if (ticket.status === "PROTECTED") {
    await db.scan.create({
      data: { code, result: "PROTECTED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({ granted: false, message: "Ticket gesperrt", ticket: ticketInfo });
  }

  const now = new Date();
  const vType = ticket.validityType ?? "DATE_RANGE";

  if (ticket.startDate) {
    const start = new Date(ticket.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
      });
      return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig", ticket: ticketInfo });
    }
  }

  if (ticket.endDate) {
    const end = new Date(ticket.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
      });
      return NextResponse.json({ granted: false, message: "Ticket abgelaufen", ticket: ticketInfo });
    }
  }

  if (vType === "TIME_SLOT" && ticket.slotStart && ticket.slotEnd) {
    const berlinNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const currentMinutes = berlinNow.getHours() * 60 + berlinNow.getMinutes();
    const [sh, sm] = ticket.slotStart.split(":").map(Number);
    const [eh, em] = ticket.slotEnd.split(":").map(Number);
    const slotStartMin = sh * 60 + sm;
    const slotEndMin = eh * 60 + em;
    if (currentMinutes < slotStartMin || currentMinutes > slotEndMin) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
      });
      return NextResponse.json({
        granted: false,
        message: `Zeitslot ${ticket.slotStart}–${ticket.slotEnd} Uhr`,
        ticket: ticketInfo,
      });
    }
  }

  if (vType === "DURATION" && ticket.validityDurationMinutes) {
    if (ticket.firstScanAt) {
      const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
      if (now > expiresAt) {
        await db.scan.create({
          data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
        });
        return NextResponse.json({ granted: false, message: "Zeitgültigkeit abgelaufen", ticket: ticketInfo });
      }
    }
  }

  const isEmployee = ticket.source === "EMP_CONTROL";

  if (accessAreaId) {
    const ticketAreaIds = ticket.ticketAreas?.map((ta) => ta.accessAreaId) ?? [];
    const allTicketAreas = ticket.accessAreaId
      ? [ticket.accessAreaId, ...ticketAreaIds]
      : ticketAreaIds;
    const hasAccess = allTicketAreas.length === 0 || allTicketAreas.includes(accessAreaId);
    if (!hasAccess) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
      });
      return NextResponse.json({ granted: false, message: "Resource nicht erlaubt", ticket: ticketInfo });
    }
  }

  await db.scan.create({
    data: { code, result: "GRANTED", ticketId: ticket.id, accountId: accountId! },
  });

  if (ticket.status === "VALID" && !isEmployee && ticket.subscriptionId == null) {
    const updateData: Record<string, unknown> = { status: "REDEEMED" };
    if (vType === "DURATION" && !ticket.firstScanAt) {
      updateData.firstScanAt = now;
    }
    await db.ticket.update({ where: { id: ticket.id }, data: updateData });
  }

  return NextResponse.json({
    granted: true,
    message: "Zutritt gewährt",
    ticket: ticketInfo,
  });
}

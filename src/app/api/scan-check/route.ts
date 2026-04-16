import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

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

        // Atomar einlösen (s. pi/scan): Ticket + Voucher-Update + Scan in einer
        // Transaktion; Voucher nur via conditional updateMany einlösen.
        // set_config für RLS innerhalb der interaktiven Transaktion.
        const redeemed = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId!)}, TRUE)`;
          const newTicket = await tx.ticket.create({
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

          const res = await tx.voucher.updateMany({
            where: { id: voucher.id, redeemedAt: null },
            data: { redeemedAt: new Date(), redeemedTicketId: newTicket.id },
          });
          if (res.count === 0) {
            throw new Error("VOUCHER_ALREADY_REDEEMED");
          }

          await tx.scan.create({
            data: { code, result: "GRANTED", ticketId: newTicket.id, accountId: accountId! },
          });

          return newTicket;
        }).catch((e) => {
          if (e instanceof Error && e.message === "VOUCHER_ALREADY_REDEEMED") {
            return null;
          }
          throw e;
        });

        if (!redeemed) {
          await db.scan.create({
            data: { code, result: "DENIED", accountId: accountId! },
          });
          return NextResponse.json({ granted: false, message: "Gutschein bereits eingelöst" });
        }

        return NextResponse.json({
          granted: true,
          message: "Gutschein eingelöst",
          ticket: {
            name: redeemed.name,
            firstName: null,
            lastName: null,
            ticketTypeName: redeemed.ticketTypeName,
            status: redeemed.status,
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

  if (ticket.status === "PAUSED") {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({ granted: false, message: "Abo pausiert", ticket: ticketInfo });
  }

  if (ticket.status === "CANCELED") {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({ granted: false, message: "Ticket storniert", ticket: ticketInfo });
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

  // Atomar: Scan + optionale Statusänderung in einer Transaktion mit version-Check,
  // um Doppel-Einlösung bei parallelen Scans zu verhindern.
  // prisma.$transaction + manuelles set_config (s. pi/scan).
  const shouldRedeem =
    ticket.status === "VALID" && !isEmployee && ticket.subscriptionId == null;

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId!)}, TRUE)`;
    if (shouldRedeem) {
      const data: { status: "REDEEMED"; version: { increment: number }; firstScanAt?: Date } = {
        status: "REDEEMED",
        version: { increment: 1 },
      };
      if (vType === "DURATION" && !ticket.firstScanAt) {
        data.firstScanAt = now;
      }
      const res = await tx.ticket.updateMany({
        where: { id: ticket.id, status: "VALID", version: ticket.version },
        data,
      });
      if (res.count === 0) {
        return { conflict: true as const };
      }
    }
    await tx.scan.create({
      data: { code, result: "GRANTED", ticketId: ticket.id, accountId: accountId! },
    });
    return { conflict: false as const };
  });

  if (txResult.conflict) {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({
      granted: false,
      message: "Konflikt: Ticket wurde bereits verarbeitet",
      ticket: ticketInfo,
    });
  }

  return NextResponse.json({
    granted: true,
    message: "Zutritt gewährt",
    ticket: ticketInfo,
  });
}

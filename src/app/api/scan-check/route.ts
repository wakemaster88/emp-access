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
    ticket = await db.ticket.findFirst({
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
      },
    });
    if (ticket) break;
  }

  if (!ticket) {
    await db.scan.create({
      data: { code, result: "DENIED", accountId: accountId! },
    });
    return NextResponse.json({
      granted: false,
      message: "Ticket nicht gefunden",
    });
  }

  if (ticket.status === "INVALID") {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({ granted: false, message: "Ticket ungültig" });
  }

  if (ticket.status === "PROTECTED") {
    await db.scan.create({
      data: { code, result: "PROTECTED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({ granted: false, message: "Ticket gesperrt" });
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
      return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig" });
    }
  }

  if (ticket.endDate) {
    const end = new Date(ticket.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
      });
      return NextResponse.json({ granted: false, message: "Ticket abgelaufen" });
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
        return NextResponse.json({ granted: false, message: "Zeitgültigkeit abgelaufen" });
      }
    }
  }

  if (accessAreaId && ticket.accessAreaId && ticket.accessAreaId !== accessAreaId) {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId: accountId! },
    });
    return NextResponse.json({ granted: false, message: "Resource nicht erlaubt" });
  }

  await db.scan.create({
    data: { code, result: "GRANTED", ticketId: ticket.id, accountId: accountId! },
  });

  if (ticket.status === "VALID") {
    const updateData: Record<string, unknown> = { status: "REDEEMED" };
    if (vType === "DURATION" && !ticket.firstScanAt) {
      updateData.firstScanAt = now;
    }
    await db.ticket.update({ where: { id: ticket.id }, data: updateData });
  }

  return NextResponse.json({
    granted: true,
    message: "Zutritt gewährt",
    ticket: {
      name: ticket.name,
      firstName: ticket.firstName,
      lastName: ticket.lastName,
      ticketTypeName: ticket.ticketTypeName,
      status: ticket.status,
      areaName: ticket.accessArea?.name ?? null,
      serviceName: ticket.service?.name ?? null,
      subscriptionName: ticket.subscription?.name ?? null,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const rawCode = String(body.code ?? "").trim();
  const code = rawCode.replace(/\s+/g, "");
  const deviceId = Number(body.deviceId);

  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
  if (isNaN(deviceId)) return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });

  const { db } = auth;
  const accountId = auth.account.id;

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId, type: "RASPBERRY_PI" },
  });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  if (!device.isActive) {
    return NextResponse.json({ granted: false, message: "Gerät deaktiviert" });
  }

  if (device.task === 3) {
    return NextResponse.json({ granted: false, message: "Gerät gesperrt" });
  }

  // Find ticket by code (try with and without spaces)
  const codesToTry = [code, rawCode];
  let ticket = null;
  for (const c of codesToTry) {
    ticket = await db.ticket.findFirst({
      where: {
        accountId,
        OR: [
          { qrCode: c },
          { rfidCode: c },
          { barcode: c },
          { uuid: c },
        ],
      },
    });
    if (ticket) break;
  }

  if (!ticket) {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket nicht gefunden" });
  }

  // Ticket status check
  if (ticket.status === "INVALID") {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket ungültig" });
  }

  if (ticket.status === "PROTECTED") {
    await db.scan.create({
      data: { code, deviceId, result: "PROTECTED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket gesperrt" });
  }

  // Date range check (dates are day-level: startDate = start of day, endDate = end of day)
  const now = new Date();
  if (ticket.startDate) {
    const start = new Date(ticket.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig" });
    }
  }
  if (ticket.endDate) {
    const end = new Date(ticket.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Ticket abgelaufen" });
    }
  }

  // Access area check (only if device has areas configured)
  if (device.accessIn || device.accessOut) {
    const allowedAreas = [device.accessIn, device.accessOut].filter(Boolean);
    if (ticket.accessAreaId && !allowedAreas.includes(ticket.accessAreaId)) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Bereich nicht erlaubt" });
    }
  }

  // Re-entry check (if disabled, check if ticket was already scanned at this device)
  if (!device.allowReentry) {
    const existingScan = await db.scan.findFirst({
      where: { ticketId: ticket.id, deviceId, result: "GRANTED" },
    });
    if (existingScan) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Kein Wiedereintritt" });
    }
  }

  // All checks passed → GRANTED
  await db.scan.create({
    data: { code, deviceId, result: "GRANTED", ticketId: ticket.id, accountId },
  });

  return NextResponse.json({
    granted: true,
    message: "Zutritt gewährt",
    ticket: {
      name: ticket.name,
      firstName: ticket.firstName,
      lastName: ticket.lastName,
    },
  });
}

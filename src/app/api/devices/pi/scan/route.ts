import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const code = String(body.code ?? "").trim();
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

  // Task 3 = device deactivated by admin
  if (device.task === 3) {
    return NextResponse.json({ granted: false, message: "Gerät gesperrt" });
  }

  // Find ticket by code across all code fields
  const ticket = await db.ticket.findFirst({
    where: {
      accountId,
      OR: [
        { qrCode: code },
        { rfidCode: code },
        { barcode: code },
        { uuid: code },
      ],
    },
  });

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

  // Date range check
  const now = new Date();
  if (ticket.startDate && now < ticket.startDate) {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig" });
  }
  if (ticket.endDate && now > ticket.endDate) {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket abgelaufen" });
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

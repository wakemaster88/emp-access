import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { checkWakesys } from "@/lib/wakesys";
import { checkBinarytec } from "@/lib/binarytec";

/** Code vom Raspberry Pi, wenn Relais per Dashboard-Button geöffnet wurde → GRANTED-Scan ohne Ticket */
const DASHBOARD_OPEN_CODE = "__DASHBOARD_OPEN__";

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

  // Dashboard-Öffnung: Relais wurde per Button geöffnet → GRANTED-Scan ohne Ticket anlegen
  if (code === DASHBOARD_OPEN_CODE) {
    await db.scan.create({
      data: { code: "Dashboard-Öffnung", deviceId, result: "GRANTED", accountId },
    });
    return NextResponse.json({ granted: true, message: "Dashboard-Öffnung erfasst" });
  }

  // Wenn Binarytec konfiguriert: nur Binarytec für Ticketprüfung (kein Sync, kein EMP-Ticket-Lookup)
  const binarytec = await checkBinarytec(db as Parameters<typeof checkBinarytec>[0], accountId, code);
  if (binarytec !== null) {
    if (binarytec.valid) {
      await db.scan.create({
        data: { code, deviceId, result: "GRANTED", accountId },
      });
      return NextResponse.json({
        granted: true,
        message: "Zutritt gewährt (Binarytec)",
      });
    }
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", accountId },
    });
    return NextResponse.json({ granted: false, message: "Zutritt verweigert (Binarytec)" });
  }

  // EMP-Tickets und ggf. Wakesys-Fallback
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
      include: { service: { select: { allowReentry: true } } },
    });
    if (ticket) break;
  }

  if (!ticket) {
    const wakesys = await checkWakesys(db as Parameters<typeof checkWakesys>[0], accountId, code);
    if (wakesys?.valid) {
      await db.scan.create({
        data: { code, deviceId, result: "GRANTED", accountId },
      });
      return NextResponse.json({
        granted: true,
        message: "Zutritt gewährt (Wakesys)",
      });
    }
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket nicht gefunden" });
  }

  // Ticket status check (VALID and REDEEMED are both accepted)
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

  const now = new Date();
  const vType = ticket.validityType ?? "DATE_RANGE";

  // --- Date range check (all types use startDate/endDate as outer bounds) ---
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

  // --- TIME_SLOT: check current time is within slotStart–slotEnd (Europe/Berlin) ---
  if (vType === "TIME_SLOT" && ticket.slotStart && ticket.slotEnd) {
    const berlinNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const currentMinutes = berlinNow.getHours() * 60 + berlinNow.getMinutes();
    const [sh, sm] = ticket.slotStart.split(":").map(Number);
    const [eh, em] = ticket.slotEnd.split(":").map(Number);
    const slotStartMin = sh * 60 + sm;
    const slotEndMin = eh * 60 + em;
    if (currentMinutes < slotStartMin || currentMinutes > slotEndMin) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: `Zeitslot ${ticket.slotStart}–${ticket.slotEnd} Uhr`,
      });
    }
  }

  // --- DURATION: check if within X minutes after first scan ---
  if (vType === "DURATION" && ticket.validityDurationMinutes) {
    if (ticket.firstScanAt) {
      const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
      if (now > expiresAt) {
        await db.scan.create({
          data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
        });
        return NextResponse.json({ granted: false, message: "Zeitgültigkeit abgelaufen" });
      }
    }
    // firstScanAt will be set below on first GRANTED scan
  }

  // Access area check (only if device has areas configured)
  if (device.accessIn || device.accessOut) {
    const allowedAreas = [device.accessIn, device.accessOut].filter(Boolean);
    if (ticket.accessAreaId && !allowedAreas.includes(ticket.accessAreaId)) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Resource nicht erlaubt" });
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

  const isExitScan = device.accessOut != null && ticket.accessAreaId === device.accessOut;

  if (ticket.status === "VALID") {
    // Erster Zutritt: auf REDEEMED setzen, ggf. firstScanAt für DURATION
    const updateData: Record<string, unknown> = { status: "REDEEMED" };
    if (vType === "DURATION" && !ticket.firstScanAt) {
      updateData.firstScanAt = now;
    }
    await db.ticket.update({
      where: { id: ticket.id },
      data: updateData,
    });
  } else if (ticket.status === "REDEEMED" && isExitScan && ticket.service?.allowReentry) {
    // Ausgangsscan + Service erlaubt Wiedereinlass: Gültigkeit zurücksetzen
    const updateData: Record<string, unknown> = { status: "VALID" };
    if (vType === "DURATION") {
      updateData.firstScanAt = null;
    }
    await db.ticket.update({
      where: { id: ticket.id },
      data: updateData,
    });
  }

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

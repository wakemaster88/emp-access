import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { berlinOffset } from "@/lib/anny-availability";
import { buildScanCodeVariants } from "@/lib/scan-code-variants";

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
  if (!rawCode) {
    return NextResponse.json({ found: false, message: "Kein Code" });
  }

  // Robust gegen DE/US-Tastaturlayout des Scanners (z.B. "GS-1234"
  // wird auf DE-Layout zu "gsß1234"), Praefix-Zeichen wie "#"/"%" und
  // unterschiedliche Schreibweisen.
  const codesToTry = buildScanCodeVariants(rawCode);
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
    // Gutschein: nicht automatisch einlösen, sondern dem Frontend
    // Voucher-Infos zurueckgeben, damit der Mitarbeiter Vor-/Nachname
    // erfasst und das Ticket bewusst erstellt. Eingeloest wird der
    // Voucher dann atomar im /ticket-Endpoint (mit voucherCode-Param).
    //
    // Wir suchen den Voucher unabhaengig vom "GS-"-Praefix, weil Codes
    // bei manchen Scannern Sonderzeichen vorne dranhaengen oder per
    // URL/QR-Code in einer abweichenden Form ankommen koennen. Die
    // Voucher-Erkennung laeuft jetzt ueber alle codeVarianten -
    // gefunden = Gutschein.
    const voucher = await prisma.voucher.findFirst({
      where: {
        accountId: monitor.accountId,
        OR: codesToTry.map((c) => ({ code: c })),
      },
    });
    if (voucher) {
      if (voucher.redeemedAt) {
        return NextResponse.json({
          found: false,
          message: "Gutschein bereits eingelöst",
        });
      }

      const [service, accessArea] = await Promise.all([
        voucher.serviceId
          ? prisma.service.findUnique({
              where: { id: voucher.serviceId },
              select: { name: true },
            })
          : Promise.resolve(null),
        voucher.accessAreaId
          ? prisma.accessArea.findUnique({
              where: { id: voucher.accessAreaId },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);

      return NextResponse.json({
        found: false,
        voucher: {
          code: voucher.code,
          ticketTypeName: voucher.ticketTypeName,
          serviceId: voucher.serviceId,
          serviceName: service?.name ?? null,
          accessAreaId: voucher.accessAreaId,
          accessAreaName: accessArea?.name ?? null,
          validityType: voucher.validityType,
          validityDurationMinutes: voucher.validityDurationMinutes,
          discountPercent: voucher.discountPercent,
        },
        message: "Gutschein erkannt – bitte Ticket vervollständigen",
      });
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

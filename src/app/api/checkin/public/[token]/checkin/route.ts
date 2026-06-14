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
  const ticketId = Number(body.ticketId);
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
    include: { service: { select: { mainAccessAreaId: true } } },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
  }

  if (ticket.status === "INVALID") {
    return NextResponse.json({ success: false, message: "Ticket ungültig" });
  }
  if (ticket.status === "PROTECTED") {
    return NextResponse.json({ success: false, message: "Ticket gesperrt" });
  }
  if (ticket.status === "PAUSED") {
    return NextResponse.json({ success: false, message: "Abo pausiert" });
  }
  if (ticket.status === "CANCELED") {
    return NextResponse.json({ success: false, message: "Abo gekündigt" });
  }

  const now = new Date();

  if (ticket.endDate && new Date(ticket.endDate) < now) {
    return NextResponse.json({ success: false, message: "Ticket abgelaufen" });
  }
  if (ticket.startDate && new Date(ticket.startDate) > now) {
    return NextResponse.json({ success: false, message: "Ticket noch nicht gültig" });
  }
  if (ticket.validityType === "DURATION" && ticket.firstScanAt && ticket.validityDurationMinutes) {
    const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
    if (now > expiresAt) {
      return NextResponse.json({ success: false, message: "Zeitticket abgelaufen" });
    }
  }

  const code = ticket.barcode || ticket.qrCode || ticket.rfidCode || `checkin:${ticket.id}`;

  await prisma.scan.create({
    data: {
      code,
      result: "GRANTED",
      ticketId: ticket.id,
      accountId: monitor.accountId,
    },
  });

  // Hauptressource (am Service konfiguriert, sonst Ticket-Feld). Beim
  // manuellen Einchecken gibt es kein Geraet/keinen Bereich als Kontext –
  // der Shop-/Check-in-Monitor steht typischerweise am Eingang/Strandbad,
  // nicht an der Hauptressource. Ein DURATION-Ticket mit Hauptressource
  // (z.B. "1 Stunde Seilbahn A") darf deshalb hier NICHT eingeloest werden
  // und der Timer NICHT starten: sonst laeuft die Zeit schon ab dem Shop-
  // Check-in statt erst am Seilbahn-Drehkreuz. Der GRANTED-Scan oben markiert
  // den Gast trotzdem als "heute eingecheckt" (checkedInForTicket prueft
  // GRANTED-Scan ODER REDEEMED). Hat das Ticket gar keine Hauptressource
  // (mainAreaId == null), bleibt das alte Verhalten.
  const mainAreaId = ticket.service?.mainAccessAreaId ?? ticket.accessAreaId;
  const isDuration = ticket.validityType === "DURATION";
  const isTransitCheckin = isDuration && mainAreaId != null;

  const updateData: Record<string, unknown> = {};
  // Mehrtage-/Abo-/Vereins-Tickets bleiben VALID – „eingecheckt“ = Scan heute,
  // nicht REDEEMED dauerhaft. Vereinsmitglieder (vereinId) sind Jahres-Mitglied-
  // schaften und zaehlen wie Abos: sonst stuenden sie nach einem Check-in an
  // jedem Tag als „eingecheckt“ und wuerden am Drehkreuz spaeter mit
  // „bereits eingelöst“ abgewiesen.
  if (
    ticket.status === "VALID" &&
    ticket.subscriptionId == null &&
    ticket.vereinId == null &&
    !isTransitCheckin
  ) {
    updateData.status = "REDEEMED";
  }
  if (isDuration && !ticket.firstScanAt && !isTransitCheckin) {
    updateData.firstScanAt = now;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
  }

  return NextResponse.json({
    success: true,
    message: "Eingecheckt",
    ticket: {
      id: ticket.id,
      name: ticket.name,
      status: updateData.status ?? ticket.status,
    },
  });
}

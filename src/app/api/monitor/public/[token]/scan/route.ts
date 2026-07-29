import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMainResourceScan, resolveMainAreaId } from "@/lib/main-resource";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive) {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
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
    return NextResponse.json({ granted: false, message: "Ticket ungültig" });
  }
  if (ticket.status === "PROTECTED") {
    return NextResponse.json({ granted: false, message: "Ticket gesperrt" });
  }
  if (ticket.status === "PAUSED") {
    return NextResponse.json({ granted: false, message: "Abo pausiert" });
  }
  if (ticket.status === "CANCELED") {
    return NextResponse.json({ granted: false, message: "Abo gekündigt" });
  }

  const now = new Date();

  if (ticket.endDate && new Date(ticket.endDate) < now) {
    return NextResponse.json({ granted: false, message: "Ticket abgelaufen" });
  }
  if (ticket.startDate && new Date(ticket.startDate) > now) {
    return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig" });
  }

  if (ticket.validityType === "DURATION" && ticket.firstScanAt && ticket.validityDurationMinutes) {
    const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
    if (now > expiresAt) {
      return NextResponse.json({ granted: false, message: "Zeitticket abgelaufen" });
    }
  }

  const code = ticket.barcode || ticket.qrCode || ticket.rfidCode || `monitor:${ticket.id}`;

  const deviceIds = (monitor.deviceIds as number[]) ?? [];
  const deviceId = deviceIds.length > 0 ? deviceIds[0] : null;

  await prisma.scan.create({
    data: {
      code,
      result: "GRANTED",
      ticketId: ticket.id,
      accountId: monitor.accountId,
      ...(deviceId ? { deviceId } : {}),
    },
  });

  // Standort des Monitors: eigene Bereichszuordnung plus die Bereiche seiner
  // Geraete. Der Strandbad-Monitor haengt an den Strandbad-Drehkreuzen, der
  // Seilbahn-A-Monitor am Seilbahn-Drehkreuz. Nur wenn die Hauptressource des
  // Tickets darunter ist, darf der Handscan die Zeit starten - sonst laeuft
  // die gebuchte Stunde eines "Öffentlicher Betrieb - 1 Stunde"-Tickets schon
  // los, wenn es am Strandbad-Monitor durchgewinkt wird.
  const monitorAreaIds = (monitor.areaIds as number[] | null) ?? [];
  const monitorDeviceAreas = deviceIds.length
    ? await prisma.device.findMany({
        where: { id: { in: deviceIds }, accountId: monitor.accountId },
        select: { accessIn: true, accessOut: true },
      })
    : [];
  const scanAreaIds = [
    ...monitorAreaIds,
    ...monitorDeviceAreas.flatMap((d) =>
      [d.accessIn, d.accessOut].filter((a): a is number => a != null),
    ),
  ];

  const updateData: Record<string, unknown> = {};
  if (
    ticket.validityType === "DURATION"
    && !ticket.firstScanAt
    && isMainResourceScan(resolveMainAreaId(ticket), scanAreaIds)
  ) {
    updateData.firstScanAt = now;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: updateData });
  }

  return NextResponse.json({
    granted: true,
    message: "Eingecheckt",
    ticket: {
      id: ticket.id,
      name: ticket.name,
      firstName: ticket.firstName,
      lastName: ticket.lastName,
    },
  });
}

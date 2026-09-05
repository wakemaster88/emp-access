import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { isMainResourceScan, resolveMainAreaId } from "@/lib/main-resource";
import { evaluateScanLock } from "@/lib/scan-lock";
import { isDurationPastBerlinDay, isDurationTicket } from "@/lib/duration-ticket";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const limited = publicRateLimit(token, "monitor-scan");
  if (limited) return limited;
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

  if (isDurationPastBerlinDay(ticket, now)) {
    return NextResponse.json({ granted: false, message: "Gültig nur am Ticket-Tag" });
  }

  const code = ticket.barcode || ticket.qrCode || ticket.rfidCode || `monitor:${ticket.id}`;

  const deviceIds = (monitor.deviceIds as number[]) ?? [];
  const deviceId = deviceIds.length > 0 ? deviceIds[0] : null;

  const monitorAreaIds = (monitor.areaIds as number[] | null) ?? [];
  const monitorDeviceAreas = deviceIds.length
    ? await prisma.device.findMany({
        where: { id: { in: deviceIds }, accountId: monitor.accountId },
        select: { accessIn: true, accessOut: true, scanLockSeconds: true },
      })
    : [];
  const scanAreaIds = [
    ...monitorAreaIds,
    ...monitorDeviceAreas.flatMap((d) =>
      [d.accessIn, d.accessOut].filter((a): a is number => a != null),
    ),
  ];
  const hitsMainResource = isMainResourceScan(resolveMainAreaId(ticket), scanAreaIds);

  // Liftzeit nur an der Hauptressource; Strandbad-Monitor bleibt am selben Tag offen.
  if (
    hitsMainResource
    && isDurationTicket(ticket)
    && ticket.firstScanAt
    && ticket.validityDurationMinutes
  ) {
    const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
    if (now > expiresAt) {
      return NextResponse.json({ granted: false, message: "Zeitticket abgelaufen" });
    }
  }

  if (deviceId) {
    const scanDevice = await prisma.device.findFirst({
      where: { id: deviceId, accountId: monitor.accountId },
      select: { scanLockSeconds: true, accessIn: true, accessOut: true },
    });
    const isExitDevice = scanDevice != null && scanDevice.accessOut != null && scanDevice.accessIn == null;
    const lock = await evaluateScanLock(prisma, {
      accountId: monitor.accountId,
      deviceId,
      lockSeconds: scanDevice?.scanLockSeconds,
      code,
      ticketId: ticket.id,
      isExit: isExitDevice,
    });
    if (lock) {
      if (!lock.silent) {
        await prisma.scan.create({
          data: {
            code,
            result: "DENIED",
            note: "scan_lock",
            ticketId: ticket.id,
            accountId: monitor.accountId,
            deviceId,
          },
        });
      }
      return NextResponse.json({ granted: false, message: lock.message, locked: true });
    }
  }

  await prisma.scan.create({
    data: {
      code,
      result: "GRANTED",
      ticketId: ticket.id,
      accountId: monitor.accountId,
      ...(deviceId ? { deviceId } : {}),
    },
  });

  const updateData: Record<string, unknown> = {};
  if (ticket.validityType === "DURATION" && !ticket.firstScanAt && hitsMainResource) {
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

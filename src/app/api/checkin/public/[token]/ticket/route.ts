import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ticketCreateSchema } from "@/lib/validators";

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
  const parsed = ticketCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  let serviceAreaIds: number[] = [];
  if (data.serviceId) {
    const svcAreas = await prisma.serviceArea.findMany({
      where: { serviceId: data.serviceId },
      select: { accessAreaId: true },
    });
    serviceAreaIds = svcAreas.map((sa: { accessAreaId: number }) => sa.accessAreaId);
  }

  const ticket = await prisma.ticket.create({
    data: {
      name: data.name,
      qrCode: data.qrCode,
      rfidCode: data.rfidCode,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      accessAreaId: data.accessAreaId,
      subscriptionId: data.subscriptionId,
      serviceId: data.serviceId,
      status: data.status ?? "VALID",
      barcode: data.barcode,
      firstName: data.firstName,
      lastName: data.lastName,
      ticketTypeName: data.ticketTypeName,
      validityType: data.validityType ?? "DATE_RANGE",
      slotStart: data.slotStart,
      slotEnd: data.slotEnd,
      validityDurationMinutes: data.validityDurationMinutes,
      profileImage: data.profileImage,
      accountId: monitor.accountId,
      ...(serviceAreaIds.length > 0 ? {
        ticketAreas: {
          create: serviceAreaIds.map((areaId) => ({ accessAreaId: areaId })),
        },
      } : {}),
    },
  });

  return NextResponse.json(ticket, { status: 201 });
}

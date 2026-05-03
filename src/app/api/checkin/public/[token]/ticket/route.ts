import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ticketCreateSchema } from "@/lib/validators";

const publicTicketCreateSchema = ticketCreateSchema.extend({
  voucherCode: z.string().min(1).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = publicTicketCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const voucherCode = data.voucherCode?.trim() || null;

  let serviceAreaIds: number[] = [];
  if (data.serviceId) {
    const svcAreas = await prisma.serviceArea.findMany({
      where: { serviceId: data.serviceId },
      select: { accessAreaId: true },
    });
    serviceAreaIds = svcAreas.map((sa: { accessAreaId: number }) => sa.accessAreaId);
  }

  const ticketData = {
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
    ...(serviceAreaIds.length > 0
      ? {
          ticketAreas: {
            create: serviceAreaIds.map((areaId) => ({ accessAreaId: areaId })),
          },
        }
      : {}),
  };

  // Wenn ein Gutschein-Code mitkommt: Ticket erstellen + Voucher atomar
  // einloesen. Bei paralleler Einloesung (z.B. 2 Tabs) gewinnt genau
  // ein Request dank `updateMany` mit `redeemedAt: null`-Filter.
  if (voucherCode) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(monitor.accountId)}, TRUE)`;

        const voucher = await tx.voucher.findUnique({
          where: { code: voucherCode },
        });
        if (!voucher || voucher.accountId !== monitor.accountId) {
          throw new Error("VOUCHER_NOT_FOUND");
        }
        if (voucher.redeemedAt) {
          throw new Error("VOUCHER_ALREADY_REDEEMED");
        }

        const newTicket = await tx.ticket.create({ data: ticketData });

        const updated = await tx.voucher.updateMany({
          where: { id: voucher.id, redeemedAt: null },
          data: { redeemedAt: new Date(), redeemedTicketId: newTicket.id },
        });
        if (updated.count === 0) {
          throw new Error("VOUCHER_ALREADY_REDEEMED");
        }

        return newTicket;
      });

      return NextResponse.json(result, { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "VOUCHER_NOT_FOUND") {
        return NextResponse.json(
          { error: { formErrors: ["Gutschein nicht gefunden."] } },
          { status: 404 },
        );
      }
      if (msg === "VOUCHER_ALREADY_REDEEMED") {
        return NextResponse.json(
          { error: { formErrors: ["Gutschein wurde bereits eingelöst."] } },
          { status: 409 },
        );
      }
      throw e;
    }
  }

  const ticket = await prisma.ticket.create({ data: ticketData });
  return NextResponse.json(ticket, { status: 201 });
}

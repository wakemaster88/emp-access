import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ticketCreateSchema } from "@/lib/validators";

const publicTicketCreateSchema = ticketCreateSchema.extend({
  voucherCode: z.string().min(1).optional(),
  // Bei Code-Konflikt mit einem bestehenden Ticket: wenn `transferCode`
  // true ist, wird der Code vom alten Ticket abgezogen und auf das neue
  // umgehaengt. Genutzt z.B. bei recycelten Tagesgast-Baendchen.
  transferCode: z.boolean().optional(),
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
  const transferCode = data.transferCode === true;

  let serviceAreaIds: number[] = [];
  if (data.serviceId) {
    const svcAreas = await prisma.serviceArea.findMany({
      where: { serviceId: data.serviceId },
      select: { accessAreaId: true },
    });
    serviceAreaIds = svcAreas.map((sa: { accessAreaId: number }) => sa.accessAreaId);
  }

  // Pre-Check: Wenn barcode/qrCode/rfidCode bereits einem Ticket im
  // gleichen Account gehoeren, brechen wir mit 409 ab statt 500 - es sei
  // denn der Aufrufer setzt `transferCode: true`, dann wird der Code
  // vom alten Ticket abgezogen und auf das neue uebertragen.
  // (Frueher hat Prisma einen Unique-Constraint-Fehler ungebremst zum
  // 500 durchgereicht.)
  const codes = [data.barcode, data.qrCode, data.rfidCode].filter(
    (c): c is string => !!c,
  );
  let conflictTicketId: number | null = null;
  if (codes.length > 0) {
    const conflict = await prisma.ticket.findFirst({
      where: {
        accountId: monitor.accountId,
        OR: [
          { barcode: { in: codes } },
          { qrCode: { in: codes } },
          { rfidCode: { in: codes } },
        ],
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
      },
    });
    if (conflict) {
      if (!transferCode) {
        const owner =
          [conflict.firstName, conflict.lastName].filter(Boolean).join(" ")
          || conflict.name;
        return NextResponse.json(
          {
            error: {
              formErrors: [
                `Code ist bereits Ticket "${owner}" zugeordnet${
                  conflict.ticketTypeName ? ` (${conflict.ticketTypeName})` : ""
                }.`,
              ],
              code: "CODE_CONFLICT",
              conflictTicketId: conflict.id,
              conflictTicketLabel: owner,
              conflictTicketType: conflict.ticketTypeName,
            },
          },
          { status: 409 },
        );
      }
      conflictTicketId = conflict.id;
    }
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

  function handleCreateError(e: unknown): NextResponse {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return NextResponse.json(
        {
          error: {
            formErrors: [
              "Code ist bereits einem anderen Ticket zugeordnet. Bitte einen anderen Code verwenden.",
            ],
          },
        },
        { status: 409 },
      );
    }
    console.error("[/api/checkin/public/[token]/ticket] create failed", { err: msg });
    return NextResponse.json(
      {
        error: {
          formErrors: [
            "Ticket konnte nicht erstellt werden. Bitte erneut versuchen.",
          ],
          serverMessage: msg,
        },
      },
      { status: 500 },
    );
  }

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
        if (voucher.disabledAt) {
          throw new Error("VOUCHER_DISABLED");
        }
        if (voucher.redeemedAt) {
          throw new Error("VOUCHER_ALREADY_REDEEMED");
        }

        if (conflictTicketId != null) {
          await tx.ticket.update({
            where: { id: conflictTicketId },
            data: { barcode: null, qrCode: null, rfidCode: null },
          });
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
      if (msg === "VOUCHER_DISABLED") {
        return NextResponse.json(
          { error: { formErrors: ["Gutschein wurde deaktiviert."] } },
          { status: 409 },
        );
      }
      return handleCreateError(e);
    }
  }

  try {
    if (conflictTicketId != null) {
      // Code-Transfer: in einer Transaktion alten Code abziehen und
      // neues Ticket mit dem Code erstellen.
      const ticket = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(monitor.accountId)}, TRUE)`;
        await tx.ticket.update({
          where: { id: conflictTicketId! },
          data: { barcode: null, qrCode: null, rfidCode: null },
        });
        return tx.ticket.create({ data: ticketData });
      });
      return NextResponse.json(ticket, { status: 201 });
    }

    const ticket = await prisma.ticket.create({ data: ticketData });
    return NextResponse.json(ticket, { status: 201 });
  } catch (e) {
    return handleCreateError(e);
  }
}

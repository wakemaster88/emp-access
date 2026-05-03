import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateApiToken } from "@/lib/api-auth";
import { getSessionWithDb } from "@/lib/api-auth";
import { ticketCreateSchema } from "@/lib/validators";

// Backoffice: gleiche Schema-Erweiterung wie im Public-Endpoint, damit
// auch hier ein "Baendchen umhaengen" moeglich ist (transferCode=true).
const backofficeTicketCreateSchema = ticketCreateSchema.extend({
  transferCode: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const hasToken = request.nextUrl.searchParams.has("token") ||
    request.headers.has("authorization");

  let db, accountId: number;

  if (hasToken) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    db = auth.db;
    accountId = auth.account.id;
  } else {
    const session = await getSessionWithDb();
    if ("error" in session) return session.error;
    db = session.db;
    accountId = session.accountId!;
  }

  const accessId = request.nextUrl.searchParams.get("access");
  const since = request.nextUrl.searchParams.get("since");

  const where: Record<string, unknown> = { accountId };
  if (accessId) where.accessAreaId = Number(accessId);
  if (since) where.version = { gt: Number(since) };

  const tickets = await db.ticket.findMany({
    where,
    include: { accessArea: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(tickets);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const parsed = backofficeTicketCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;
  const transferCode = data.transferCode === true;

  let serviceAreaIds: number[] = [];
  if (data.serviceId) {
    const svcAreas = await db.serviceArea.findMany({
      where: { serviceId: data.serviceId },
      select: { accessAreaId: true },
    });
    serviceAreaIds = svcAreas.map((sa: { accessAreaId: number }) => sa.accessAreaId);
  }

  // Vor dem Insert pruefen, ob Code bereits vergeben ist. So kommt der
  // klassische "RFID schon in Verwendung"-Fall nicht als 500 raus, sondern
  // als 409 mit klarer Meldung. Mit transferCode=true wird der Code vom
  // alten Ticket abgezogen und auf das neue umgehaengt.
  let conflictTicketId: number | null = null;
  if (data.barcode || data.qrCode || data.rfidCode) {
    const codes = [data.barcode, data.qrCode, data.rfidCode].filter(
      (c): c is string => !!c,
    );
    if (codes.length > 0) {
      const conflict = await db.ticket.findFirst({
        where: {
          accountId: accountId!,
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
  }

  try {
    if (conflictTicketId != null) {
      // Code-Transfer: alten Code zuerst abziehen, dann neues Ticket
      // erstellen. Sequenziell statt atomar, weil der extended Prisma-
      // Client den Callback-Stil von $transaction nicht typisiert
      // erlaubt. Im Fehlerfall des Create laesst sich das alte Ticket
      // manuell neu mit einem Code versehen.
      await db.ticket.update({
        where: { id: conflictTicketId },
        data: { barcode: null, qrCode: null, rfidCode: null },
      });
    }

    const ticket = await db.ticket.create({
      data: buildTicketData(),
    });

    return NextResponse.json(ticket, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Prisma P2002: unique constraint - i.d.R. barcode bereits vergeben
    // (z. B. wenn parallele Anfragen knapp daneben gelaufen sind).
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
    console.error("[/api/tickets] create failed", { err: msg });
    return NextResponse.json(
      {
        error: {
          formErrors: [
            "Ticket konnte nicht erstellt werden. Bitte erneut versuchen oder Logs pruefen.",
          ],
          serverMessage: msg,
        },
      },
      { status: 500 },
    );
  }

  function buildTicketData() {
    return {
      name: data.name,
      qrCode: data.qrCode,
      rfidCode: data.rfidCode,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      accessAreaId: data.accessAreaId,
      subscriptionId: data.subscriptionId,
      serviceId: data.serviceId,
      vereinId: data.vereinId,
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
      email: data.email,
      accountId: accountId!,
      ...(serviceAreaIds.length > 0
        ? {
            ticketAreas: {
              create: serviceAreaIds.map((areaId) => ({ accessAreaId: areaId })),
            },
          }
        : {}),
    };
  }
}

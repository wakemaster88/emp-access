import { NextRequest, NextResponse } from "next/server";
import { dayTicketEmailChanged } from "@/lib/day-guest";
import type { PrismaClient } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";
import { ticketUpdateSchema } from "@/lib/validators";
import { profilePhotoUpdate } from "@/lib/photo-url";
import { buildMissingCardWarning } from "@/lib/ticket-card-warning";
import { foreignRefError } from "@/lib/tenant-refs";
import { aboEmailError, cleanEmail } from "@/lib/abo-email";
import { linkAboCustomerSafe } from "@/lib/customers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (isNaN(ticketId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, accountId: accountId! },
    include: { _count: { select: { scans: true } }, ticketAreas: { include: { accessArea: { select: { id: true, name: true } } } } },
  });
  if (!ticket) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(ticket);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (isNaN(ticketId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = ticketUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const existing = await db.ticket.findFirst({
    where: { id: ticketId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const photo = profilePhotoUpdate(data.profileImage, existing.profileImage);
  if ("error" in photo) {
    return NextResponse.json({ error: { formErrors: [photo.error], fieldErrors: { profileImage: [photo.error] } } }, { status: 400 });
  }

  // Jedes Abo hängt an einer E-Mail-Adresse (siehe lib/abo-email).
  const emailError = aboEmailError(existing, {
    subscriptionId: data.subscriptionId !== undefined ? data.subscriptionId : existing.subscriptionId,
    email: data.email !== undefined ? data.email : existing.email,
  });
  if (emailError) {
    return NextResponse.json({ error: { formErrors: [emailError], fieldErrors: { email: [emailError] } } }, { status: 400 });
  }

  const refError = await foreignRefError(db, accountId, {
    accessAreaIds: [data.accessAreaId],
    subscriptionIds: [data.subscriptionId],
    serviceIds: [data.serviceId],
    vereinIds: [data.vereinId],
  });
  if (refError) {
    return NextResponse.json({ error: { formErrors: [refError], fieldErrors: {} } }, { status: 400 });
  }

  // Code-Eindeutigkeit erzwingen: rfidCode/qrCode sind im Schema NICHT unique
  // (nur barcode/uuid). Ohne diese Pruefung kann derselbe Code an mehreren
  // Tickets haengen, was beim Scan zum falschen Ticket fuehrt (z.B. ein altes
  // abgelaufenes Zeitticket statt des gueltigen Abos). Wie beim Erstellen
  // (POST /api/tickets) verhindern wir Konflikte: Standard = 409 CODE_CONFLICT,
  // mit `transferCode=true` wird der Code von ALLEN anderen Tickets abgezogen.
  const newCodes = [data.barcode, data.qrCode, data.rfidCode].filter(
    (c): c is string => !!c,
  );
  if (newCodes.length > 0) {
    const transferCode = body.transferCode === true;
    const conflictWhere = {
      accountId: accountId!,
      id: { not: ticketId },
      OR: [
        { barcode: { in: newCodes } },
        { qrCode: { in: newCodes } },
        { rfidCode: { in: newCodes } },
      ],
    };
    const conflict = await db.ticket.findFirst({
      where: conflictWhere,
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
      // Transfer: Code von allen anderen Tickets abziehen (raeumt auch bereits
      // bestehende Duplikate auf), damit er danach eindeutig diesem Ticket
      // gehoert.
      await db.ticket.updateMany({
        where: conflictWhere,
        data: { barcode: null, qrCode: null, rfidCode: null, version: { increment: 1 } },
      });
    }
  }

  const ticket = await db.ticket.update({
    where: { id: ticketId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.ticketTypeName !== undefined && { ticketTypeName: data.ticketTypeName }),
      ...(data.barcode !== undefined && { barcode: data.barcode }),
      ...(data.qrCode !== undefined && { qrCode: data.qrCode }),
      ...(data.rfidCode !== undefined && { rfidCode: data.rfidCode }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.accessAreaId !== undefined && { accessAreaId: data.accessAreaId }),
      ...(data.subscriptionId !== undefined && { subscriptionId: data.subscriptionId }),
      ...(data.serviceId !== undefined && { serviceId: data.serviceId }),
      ...(data.vereinId !== undefined && { vereinId: data.vereinId }),
      ...(data.validityType !== undefined && { validityType: data.validityType }),
      ...(data.slotStart !== undefined && { slotStart: data.slotStart }),
      ...(data.slotEnd !== undefined && { slotEnd: data.slotEnd }),
      ...(data.validityDurationMinutes !== undefined && { validityDurationMinutes: data.validityDurationMinutes }),
      ...(photo.value !== undefined && { profileImage: photo.value }),
      ...(data.email !== undefined && { email: cleanEmail(data.email) }),
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      version: { increment: 1 },
    },
  });

  // Abo: Kundenkonto zur (neuen) Adresse und Person (lib/customers).
  if (ticket.subscriptionId != null && (data.email !== undefined || data.subscriptionId !== undefined)) {
    await linkAboCustomerSafe(accountId!, ticket.id);
  }

  // Tagesgäste: das Ticket folgt seiner Adresse ins passende App-Profil.
  if (data.email !== undefined) {
    await dayTicketEmailChanged(
      accountId!,
      [{ id: existing.id, email: existing.email }],
      ticket.email?.trim().toLowerCase() || null,
    ).catch((err) => {
      console.error("[tickets] day ticket email failed:", err);
    });
  }

  // Siehe POST /api/tickets: Abo ohne Karte ist nicht scanbar - der Scan
  // trifft dann weiter das alte Ticket der Person.
  const warning = await buildMissingCardWarning(
    db as unknown as PrismaClient,
    accountId!,
    ticket,
  );

  return NextResponse.json(warning ? { ...ticket, warning } : ticket);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const ticketId = Number(id);
  if (isNaN(ticketId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.ticket.findFirst({
    where: { id: ticketId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.ticket.delete({ where: { id: ticketId } });

  return NextResponse.json({ ok: true });
}

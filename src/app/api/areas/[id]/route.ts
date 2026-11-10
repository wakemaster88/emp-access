import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { parseScanLockSeconds } from "@/lib/scan-lock";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const areaId = Number(id);
  if (isNaN(areaId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.accessArea.findFirst({
    where: { id: areaId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const area = await db.accessArea.update({
    where: { id: areaId },
    data: {
      name: body.name?.trim() ?? existing.name,
      parentId: body.parentId !== undefined ? (body.parentId ? Number(body.parentId) : null) : existing.parentId,
      allowReentry: body.allowReentry ?? existing.allowReentry,
      personLimit: body.personLimit !== undefined ? (body.personLimit ? Number(body.personLimit) : null) : existing.personLimit,
      scanLockSeconds: parseScanLockSeconds(body.scanLockSeconds, existing.scanLockSeconds),
      showOnDashboard: body.showOnDashboard !== undefined ? body.showOnDashboard : existing.showOnDashboard,
      openingHours: body.openingHours !== undefined ? (body.openingHours || null) : existing.openingHours,
    },
  });
  return NextResponse.json(area);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const areaId = Number(id);
  if (isNaN(areaId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.accessArea.findFirst({
    where: { id: areaId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Ein Ticket ohne Bereich gilt an jedem Leser ("Kein Bereich" ist eine
  // bewusste Einstellung). Wuerde der Bereich einfach geloescht, verloeren
  // die daran haengenden Tickets ihre Einschraenkung stillschweigend
  // (accessAreaId -> NULL, TicketArea-Zeilen weg) und kaemen ueberall durch.
  // Deshalb erst loeschen, wenn kein noch gueltiges Ticket mehr daran haengt.
  const now = new Date();
  const ticketsInUse = await db.ticket.count({
    where: {
      accountId: accountId!,
      status: { in: ["VALID", "REDEEMED", "PAUSED"] },
      AND: [
        { OR: [{ accessAreaId: areaId }, { ticketAreas: { some: { accessAreaId: areaId } } }] },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
    },
  });
  if (ticketsInUse > 0) {
    return NextResponse.json(
      {
        error:
          `Der Bereich wird noch von ${ticketsInUse} gültigen Ticket(s) verwendet. ` +
          "Bitte die Tickets zuerst einem anderen Bereich zuordnen oder ungültig setzen.",
        ticketsInUse,
      },
      { status: 409 },
    );
  }

  await db.accessArea.delete({ where: { id: areaId } });
  return NextResponse.json({ ok: true });
}

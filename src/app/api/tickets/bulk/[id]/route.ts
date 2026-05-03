import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * Liefert alle Tickets eines Bulks fuer den Reprint-Workflow.
 * Sortiert nach Erstellungs-Reihenfolge.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Bulk-ID fehlt." }, { status: 400 });
  }

  const tickets = await db.ticket.findMany({
    where: { accountId: accountId!, bulkBatchId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      barcode: true,
      qrCode: true,
      ticketTypeName: true,
      startDate: true,
      endDate: true,
      slotStart: true,
      slotEnd: true,
      accessAreaId: true,
      accessArea: { select: { name: true } },
      validityType: true,
      validityDurationMinutes: true,
      status: true,
      createdAt: true,
    },
  });

  if (tickets.length === 0) {
    return NextResponse.json({ error: "Bulk nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({
    bulkBatchId: id,
    tickets: tickets.map((t: (typeof tickets)[number]) => ({
      id: t.id,
      name: t.name,
      barcode: t.barcode ?? "",
      qrCode: t.qrCode,
      ticketTypeName: t.ticketTypeName,
      startDate: t.startDate?.toISOString() ?? null,
      endDate: t.endDate?.toISOString() ?? null,
      slotStart: t.slotStart,
      slotEnd: t.slotEnd,
      accessAreaId: t.accessAreaId,
      accessAreaName: t.accessArea?.name ?? null,
      validityType: t.validityType,
      validityDurationMinutes: t.validityDurationMinutes,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    })),
  });
}

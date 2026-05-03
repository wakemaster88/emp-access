import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { ticketBulkCreateSchema } from "@/lib/validators";

/**
 * Bulk-Erstellung von Tickets fuer den Bondrucker-Workflow.
 * Erzeugt N Tickets mit auto-generierten, eindeutigen Barcodes.
 * Bei Konflikt (sehr unwahrscheinlich) werden Codes neu generiert.
 */

function randomCode(prefix: string): string {
  const uuid = (typeof globalThis.crypto?.randomUUID === "function")
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const compact = uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${compact}`;
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json().catch(() => ({}));
  const parsed = ticketBulkCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;
  const codePrefix = (data.codePrefix ?? "BLK").toUpperCase();
  const namePrefix = data.namePrefix?.trim() || "Ticket";

  let serviceAreaIds: number[] = [];
  if (data.serviceId) {
    const svcAreas = await db.serviceArea.findMany({
      where: { serviceId: data.serviceId },
      select: { accessAreaId: true },
    });
    serviceAreaIds = svcAreas.map((sa: { accessAreaId: number }) => sa.accessAreaId);
  }

  const startDate = data.startDate ? new Date(data.startDate) : undefined;
  const endDate = data.endDate ? new Date(data.endDate) : undefined;

  let accessAreaName: string | null = null;
  if (data.accessAreaId) {
    const area = await db.accessArea.findFirst({
      where: { id: data.accessAreaId, accountId: accountId! },
      select: { name: true },
    });
    accessAreaName = area?.name ?? null;
  }

  const created: Array<{
    id: number;
    name: string;
    barcode: string;
    qrCode: string | null;
    ticketTypeName: string | null;
    startDate: string | null;
    endDate: string | null;
    slotStart: string | null;
    slotEnd: string | null;
    accessAreaId: number | null;
    accessAreaName: string | null;
    validityType: string;
    validityDurationMinutes: number | null;
  }> = [];

  for (let i = 0; i < data.count; i++) {
    const name = data.names?.[i]?.trim() || `${namePrefix} ${i + 1}`;

    let attempts = 0;
    let inserted: Awaited<ReturnType<typeof db.ticket.create>> | null = null;
    while (attempts < 5 && inserted == null) {
      attempts++;
      const code = randomCode(codePrefix);
      try {
        inserted = await db.ticket.create({
          data: {
            name,
            barcode: code,
            qrCode: code,
            startDate,
            endDate,
            accessAreaId: data.accessAreaId ?? undefined,
            subscriptionId: data.subscriptionId ?? undefined,
            serviceId: data.serviceId ?? undefined,
            status: "VALID",
            ticketTypeName: data.ticketTypeName ?? undefined,
            validityType: data.validityType ?? "DATE_RANGE",
            slotStart: data.slotStart ?? undefined,
            slotEnd: data.slotEnd ?? undefined,
            validityDurationMinutes: data.validityDurationMinutes ?? undefined,
            accountId: accountId!,
            ...(serviceAreaIds.length > 0
              ? {
                  ticketAreas: {
                    create: serviceAreaIds.map((areaId) => ({ accessAreaId: areaId })),
                  },
                }
              : {}),
          },
        });
      } catch (e) {
        // Unique-Konflikt → erneut versuchen mit neuem Code
        const msg = e instanceof Error ? e.message : "";
        if (!msg.includes("Unique") && !msg.includes("unique")) throw e;
      }
    }

    if (!inserted) {
      return NextResponse.json(
        {
          error: "Bulk-Erstellung fehlgeschlagen: Konnten keine eindeutigen Codes erzeugen.",
          createdCount: created.length,
        },
        { status: 500 },
      );
    }

    created.push({
      id: inserted.id,
      name: inserted.name,
      barcode: inserted.barcode!,
      qrCode: inserted.qrCode,
      ticketTypeName: inserted.ticketTypeName,
      startDate: inserted.startDate?.toISOString() ?? null,
      endDate: inserted.endDate?.toISOString() ?? null,
      slotStart: inserted.slotStart,
      slotEnd: inserted.slotEnd,
      accessAreaId: inserted.accessAreaId,
      accessAreaName,
      validityType: inserted.validityType,
      validityDurationMinutes: inserted.validityDurationMinutes,
    });
  }

  return NextResponse.json({ tickets: created }, { status: 201 });
}

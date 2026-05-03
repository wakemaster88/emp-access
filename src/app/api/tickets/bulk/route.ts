import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { ticketBulkCreateSchema } from "@/lib/validators";

/**
 * Bulk-Erstellung von Tickets fuer den Bondrucker-Workflow.
 * Erzeugt N Tickets mit auto-generierten, eindeutigen Barcodes.
 * Bei Konflikt (sehr unwahrscheinlich) werden Codes neu generiert.
 *
 * Alle Tickets aus einem POST-Request teilen sich eine `bulkBatchId`
 * (UUID). Damit kann das Backoffice spaeter die Bulks listen und
 * komplett erneut drucken.
 */

function randomUuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function randomCode(prefix: string): string {
  const compact = randomUuid().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${compact}`;
}

interface BulkOverview {
  id: string;
  count: number;
  createdAt: string | null;
  lastCreatedAt: string | null;
  namePrefix: string | null;
  ticketTypeName: string | null;
  serviceId: number | null;
  serviceName: string | null;
  subscriptionId: number | null;
  subscriptionName: string | null;
  accessAreaId: number | null;
  accessAreaName: string | null;
  startDate: string | null;
  endDate: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  validityType: string | null;
  validityDurationMinutes: number | null;
  statusCounts: Record<string, number>;
}

/**
 * Liste aller Bulk-Erstellungen fuer das aktuelle Account.
 * Aggregiert pro `bulkBatchId`: Anzahl, Zeitstempel, Status-Verteilung,
 * Ticketyp/Service/Subscription, Validity-Felder.
 *
 * Hinweis: wir gruppieren in JavaScript anstatt mit Prisma.groupBy, weil
 * der Tenant-Client-Wrapper fuer groupBy keine kompatible Signatur hat.
 * Performance ist unkritisch – pro Account selten > paar tausend Bulk-
 * Tickets, die hier nur mit den fuer die Anzeige noetigen Feldern
 * geladen werden.
 */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const tickets = await db.ticket.findMany({
    where: { accountId: accountId!, bulkBatchId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      bulkBatchId: true,
      name: true,
      ticketTypeName: true,
      startDate: true,
      endDate: true,
      slotStart: true,
      slotEnd: true,
      validityType: true,
      validityDurationMinutes: true,
      status: true,
      serviceId: true,
      subscriptionId: true,
      accessAreaId: true,
      createdAt: true,
      service: { select: { name: true } },
      subscription: { select: { name: true } },
      accessArea: { select: { name: true } },
    },
  });

  if (tickets.length === 0) {
    return NextResponse.json({ bulks: [] });
  }

  type Row = (typeof tickets)[number];
  const byBulk = new Map<string, Row[]>();
  for (const t of tickets) {
    if (!t.bulkBatchId) continue;
    const arr = byBulk.get(t.bulkBatchId) ?? [];
    arr.push(t);
    byBulk.set(t.bulkBatchId, arr);
  }

  const bulks: BulkOverview[] = [];
  for (const [id, rows] of byBulk) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const statusCounts: Record<string, number> = {};
    for (const r of rows) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }
    const prefixes = new Set(
      rows.map((r) => r.name.replace(/\s+\d+\s*$/, "").trim()),
    );
    const namePrefix = prefixes.size === 1 ? [...prefixes][0] : null;

    bulks.push({
      id,
      count: rows.length,
      createdAt: first?.createdAt.toISOString() ?? null,
      lastCreatedAt: last?.createdAt.toISOString() ?? null,
      namePrefix,
      ticketTypeName: first?.ticketTypeName ?? null,
      serviceId: first?.serviceId ?? null,
      serviceName: first?.service?.name ?? null,
      subscriptionId: first?.subscriptionId ?? null,
      subscriptionName: first?.subscription?.name ?? null,
      accessAreaId: first?.accessAreaId ?? null,
      accessAreaName: first?.accessArea?.name ?? null,
      startDate: first?.startDate?.toISOString() ?? null,
      endDate: first?.endDate?.toISOString() ?? null,
      slotStart: first?.slotStart ?? null,
      slotEnd: first?.slotEnd ?? null,
      validityType: first?.validityType ?? null,
      validityDurationMinutes: first?.validityDurationMinutes ?? null,
      statusCounts,
    });
  }

  bulks.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return NextResponse.json({ bulks });
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
  const bulkBatchId = randomUuid();

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
            bulkBatchId,
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

  return NextResponse.json({ tickets: created, bulkBatchId }, { status: 201 });
}

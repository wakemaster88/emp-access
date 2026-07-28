import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { createTicketBulk } from "@/lib/ticket-bulk";
import { ticketBulkCreateSchema } from "@/lib/validators";

/**
 * Bulk-Erstellung von Tickets fuer den Bondrucker-Workflow.
 * Erzeugt N Tickets mit auto-generierten, eindeutigen Barcodes.
 * Bei Konflikt (sehr unwahrscheinlich) werden Codes neu generiert.
 *
 * Alle Tickets aus einem POST-Request teilen sich eine `bulkBatchId`
 * (UUID). Damit kann das Backoffice spaeter die Bulks listen und
 * komplett erneut drucken.
 *
 * Die eigentliche Erstellung liegt in `src/lib/ticket-bulk.ts` – der
 * Shop-Monitor nutzt sie ueber seine eigene Token-Route mit.
 */

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
  /**
   * Klassifizierung des Bulks fuer das Frontend:
   *  - "PRINT": klassischer Bondrucker-Bulk (Tickets haben Barcode/QR)
   *  - "RFID":  RFID-Baendchen-Bulk (Tickets haben rfidCode, kein Barcode)
   *  - "MIXED": Bulks mit beiden Typen (Edge-Case, z. B. nachtraeglich
   *             editiert) – im Frontend behandeln wir sie wie PRINT.
   */
  kind: "PRINT" | "RFID" | "MIXED";
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
      barcode: true,
      rfidCode: true,
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
    let printableCount = 0;
    let rfidOnlyCount = 0;
    for (const r of rows) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
      const hasBarcode = !!r.barcode;
      const hasRfid = !!r.rfidCode;
      if (hasBarcode) printableCount++;
      else if (hasRfid) rfidOnlyCount++;
    }
    // Namens-Praefix-Erkennung: PRINT-Bulks haben "Praefix N",
    // RFID-Bulks haben "Praefix CODE" – beides am Ende abschneiden.
    const prefixes = new Set(
      rows
        .map((r) => r.name.replace(/\s+\S+\s*$/, "").trim())
        .filter((p) => p.length > 0),
    );
    const namePrefix = prefixes.size === 1 ? [...prefixes][0] : null;

    let kind: BulkOverview["kind"] = "PRINT";
    if (printableCount === 0 && rfidOnlyCount > 0) {
      kind = "RFID";
    } else if (printableCount > 0 && rfidOnlyCount > 0) {
      kind = "MIXED";
    }

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
      kind,
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
  const result = await createTicketBulk(db, accountId!, parsed.data);
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json(
    { tickets: result.tickets, bulkBatchId: result.bulkBatchId, kind: result.kind },
    { status: 201 },
  );
}

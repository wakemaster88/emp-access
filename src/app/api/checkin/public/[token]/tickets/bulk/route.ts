import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { createTicketBulk } from "@/lib/ticket-bulk";
import { ticketBulkCreateSchema } from "@/lib/validators";

/** Je Aufruf bis zu 100 Tickets; von Hand ausgeloest, daher reichen 30 pro Minute. */
const BULK_LIMIT = { limit: 30, windowMs: 60_000 } as const;

/**
 * Bulk-Erstellung am Shop-/Checkin-Monitor: Bon-Tickets in Serie oder ein
 * Ticket je gescanntem RFID-Baendchen. Fachlich identisch zum Dashboard
 * (`/api/tickets/bulk`), nur mit Monitor-Token statt Session.
 *
 * Wir arbeiten hier bewusst ueber `tenantClient(accountId)` statt ueber den
 * rohen Prisma-Client: Der Monitor-Token steckt in einer Kiosk-URL und ist
 * damit ein vergleichsweise schwaches Geheimnis. Row Level Security ist die
 * zusaetzliche Absicherung dagegen, dass ueber manipulierte Service- oder
 * Bereichs-IDs Daten eines anderen Mandanten entstehen.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-tickets-bulk", BULK_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = ticketBulkCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = tenantClient(monitor.accountId);
  const result = await createTicketBulk(db, monitor.accountId, parsed.data);
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json(
    { tickets: result.tickets, bulkBatchId: result.bulkBatchId, kind: result.kind },
    { status: 201 },
  );
}

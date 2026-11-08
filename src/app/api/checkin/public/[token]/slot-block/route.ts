import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { blockServiceSlot, releaseSlotBlock } from "@/lib/slot-blocks";

export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * POST: sperrt einen Slot. Belegt die volle Restkapazitaet des Slots in
 * ANNY ueber einen nativen Blocker und legt einen SlotBlock-Datensatz an
 * (Logik in src/lib/slot-blocks.ts).
 *
 * Body: { serviceId, date (YYYY-MM-DD), slotStart (HH:mm), slotEnd (HH:mm), reason? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const accountId = monitor.accountId;

  let body: {
    serviceId?: number;
    date?: string;
    slotStart?: string;
    slotEnd?: string;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungueltiger Body" }, { status: 400 });
  }

  const serviceId = Number(body.serviceId);
  const date = (body.date ?? "").trim();
  const slotStart = (body.slotStart ?? "").trim();
  const slotEnd = (body.slotEnd ?? "").trim();
  const reason = body.reason?.trim() || null;

  if (!Number.isInteger(serviceId) || !DATE_RE.test(date) || !TIME_RE.test(slotStart) || !TIME_RE.test(slotEnd)) {
    return NextResponse.json({ error: "serviceId, date (YYYY-MM-DD), slotStart/slotEnd (HH:mm) erforderlich" }, { status: 400 });
  }

  const result = await blockServiceSlot(accountId, { serviceId, date, slotStart, slotEnd, reason });
  return NextResponse.json(result.body, { status: result.status });
}

/**
 * DELETE: hebt einen Slot-Block auf. Storniert alle zugehoerigen
 * ANNY-Platzhalter-Buchungen und loescht den SlotBlock. Schlaegt ein
 * ANNY-Storno fehl, bleibt der Block erhalten und es wird 502 zurueckgegeben.
 *
 * Body: { blockId }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const accountId = monitor.accountId;

  let body: { blockId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungueltiger Body" }, { status: 400 });
  }
  const blockId = Number(body.blockId);
  if (!Number.isInteger(blockId)) {
    return NextResponse.json({ error: "blockId erforderlich" }, { status: 400 });
  }

  const block = await prisma.slotBlock.findFirst({ where: { id: blockId, accountId } });
  if (!block) {
    return NextResponse.json({ error: "Sperre nicht gefunden" }, { status: 404 });
  }
  // Sperren aus dem Vereinsportal gehoeren zu einer Buchung, die abgerechnet
  // wird. Die hebt nur ein Storno der Buchung auf (Backoffice oder Verein).
  const vereinBooking = await prisma.vereinSlotBooking.findFirst({
    where: { accountId, slotBlockId: block.id, status: "BOOKED" },
    select: { verein: { select: { name: true } } },
  });
  if (vereinBooking) {
    return NextResponse.json(
      {
        error: `Der Slot ist von ${vereinBooking.verein.name} gebucht. Storniere die Buchung unter Vereine · Buchungen.`,
      },
      { status: 409 },
    );
  }

  const result = await releaseSlotBlock(accountId, block);
  return NextResponse.json(result.body, { status: result.status });
}

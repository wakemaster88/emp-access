import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

function currentYearBerlin(): number {
  const fmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" });
  const y = Number(fmt.format(new Date()));
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

const upsertSchema = z.object({
  ticketId: z.coerce.number().int().positive(),
  keysIssued: z.coerce.number().int().min(0).max(20).optional(),
  keysReturned: z.coerce.number().int().min(0).max(20).optional(),
  /// Akzeptiert ISO-Datum/-DateTime; "" oder null entfernt das Datum.
  issuedAt: z.union([z.string(), z.null()]).optional(),
  returnedAt: z.union([z.string(), z.null()]).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const rentalSelect = {
  id: true,
  year: true,
  ticketId: true,
  keysIssued: true,
  keysReturned: true,
  issuedAt: true,
  returnedAt: true,
  notes: true,
  ticket: {
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      ticketTypeName: true,
      status: true,
      endDate: true,
      profileImage: true,
      subscription: { select: { id: true, name: true } },
    },
  },
} as const;

async function resolveMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return null;
  return monitor;
}

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/// Upsert der Vermietung für das aktuelle Jahr (1 Locker × 1 Mieter pro Jahr).
/// Wird auch zum Updaten der Schlüssel-Felder benutzt.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const lockerId = Number(id);
  if (isNaN(lockerId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const year = currentYearBerlin();

  // Tenant-Check für Locker und Ticket parallel.
  const [locker, ticket] = await Promise.all([
    prisma.locker.findFirst({
      where: { id: lockerId, accountId: monitor.accountId },
      select: { id: true },
    }),
    prisma.ticket.findFirst({
      where: { id: data.ticketId, accountId: monitor.accountId },
      select: { id: true },
    }),
  ]);
  if (!locker) return NextResponse.json({ error: "Schließfach nicht gefunden" }, { status: 404 });
  if (!ticket) return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 400 });

  const issuedAt = parseDate(data.issuedAt);
  const returnedAt = parseDate(data.returnedAt);

  try {
    const rental = await prisma.lockerRental.upsert({
      where: { lockerId_year: { lockerId, year } },
      create: {
        lockerId,
        ticketId: data.ticketId,
        year,
        keysIssued: data.keysIssued ?? 0,
        keysReturned: data.keysReturned ?? 0,
        issuedAt: issuedAt ?? null,
        returnedAt: returnedAt ?? null,
        notes: data.notes?.trim() || null,
      },
      update: {
        ticketId: data.ticketId,
        ...(data.keysIssued !== undefined && { keysIssued: data.keysIssued }),
        ...(data.keysReturned !== undefined && { keysReturned: data.keysReturned }),
        ...(data.issuedAt !== undefined && { issuedAt: issuedAt }),
        ...(data.returnedAt !== undefined && { returnedAt: returnedAt }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
      },
      select: rentalSelect,
    });
    return NextResponse.json({
      year,
      rental: {
        ...rental,
        issuedAt: rental.issuedAt ? rental.issuedAt.toISOString() : null,
        returnedAt: rental.returnedAt ? rental.returnedAt.toISOString() : null,
        ticket: {
          ...rental.ticket,
          endDate: rental.ticket.endDate ? rental.ticket.endDate.toISOString() : null,
        },
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unbekannter Fehler" },
      { status: 500 },
    );
  }
}

/// Vermietung des aktuellen Jahres aufheben (Schließfach wird wieder frei).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const lockerId = Number(id);
  if (isNaN(lockerId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const year = currentYearBerlin();
  const existing = await prisma.lockerRental.findFirst({
    where: { lockerId, year, locker: { accountId: monitor.accountId } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ ok: true, deleted: false });

  await prisma.lockerRental.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true, deleted: true });
}

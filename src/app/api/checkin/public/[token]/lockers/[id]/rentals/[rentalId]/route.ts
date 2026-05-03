import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/// Punktuelles Update einer einzelnen (auch alten) Vermietung – z. B. um aus
/// dem Shop-Monitor heraus rückwirkend die zurückgegebenen Schlüssel zu
/// setzen.  Tenant-Check läuft über den Monitor-Token ↔ Locker-Account.
const patchSchema = z.object({
  keysIssued: z.coerce.number().int().min(0).max(20).optional(),
  keysReturned: z.coerce.number().int().min(0).max(20).optional(),
  issuedAt: z.union([z.string(), z.null()]).optional(),
  returnedAt: z.union([z.string(), z.null()]).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const rentalSelect = {
  id: true,
  year: true,
  ticketId: true,
  renterName: true,
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

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

async function resolveAccountId(token: string): Promise<number | null> {
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return null;
  return monitor.accountId;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string; rentalId: string }> }
) {
  const { token, id, rentalId } = await params;
  const accountId = await resolveAccountId(token);
  if (accountId === null) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const lockerId = Number(id);
  const rid = Number(rentalId);
  if (isNaN(lockerId) || isNaN(rid)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Tenant-Check via Locker → Account
  const existing = await prisma.lockerRental.findFirst({
    where: { id: rid, lockerId, locker: { accountId } },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Vermietung nicht gefunden" }, { status: 404 });
  }

  const issuedAt = parseDate(data.issuedAt);
  const returnedAt = parseDate(data.returnedAt);

  const updated = await prisma.lockerRental.update({
    where: { id: rid },
    data: {
      ...(data.keysIssued !== undefined && { keysIssued: data.keysIssued }),
      ...(data.keysReturned !== undefined && { keysReturned: data.keysReturned }),
      ...(data.issuedAt !== undefined && { issuedAt }),
      ...(data.returnedAt !== undefined && { returnedAt }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
    select: rentalSelect,
  });

  return NextResponse.json({
    rental: {
      ...updated,
      issuedAt: updated.issuedAt ? updated.issuedAt.toISOString() : null,
      returnedAt: updated.returnedAt ? updated.returnedAt.toISOString() : null,
      ticket: updated.ticket
        ? {
            ...updated.ticket,
            endDate: updated.ticket.endDate ? updated.ticket.endDate.toISOString() : null,
          }
        : null,
    },
  });
}

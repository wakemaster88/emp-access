import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidityType } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";

const VALIDITY_TYPES: ValidityType[] = ["DATE_RANGE", "TIME_SLOT", "DURATION"];

const updateSchema = z.object({
  ticketTypeName: z.string().trim().min(1).nullable().optional(),
  serviceId: z.number().int().nullable().optional(),
  accessAreaId: z.number().int().nullable().optional(),
  validityType: z.enum(["DATE_RANGE", "TIME_SLOT", "DURATION"]).optional(),
  validityDurationMinutes: z.number().int().positive().nullable().optional(),
  discountPercent: z.number().int().min(0).max(100).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
  disabled: z.boolean().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const voucherId = Number(id);
  if (Number.isNaN(voucherId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const { db, accountId } = session;
  const voucher = await db.voucher.findFirst({
    where: { id: voucherId, ...(accountId ? { accountId } : {}) },
  });
  if (!voucher) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  return NextResponse.json(voucher);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const voucherId = Number(id);
  if (Number.isNaN(voucherId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const { db, accountId } = session;
  const existing = await db.voucher.findFirst({
    where: { id: voucherId, ...(accountId ? { accountId } : {}) },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  // Bereits eingeloeste Gutscheine duerfen nur an Notiz/Verfall/Disabled-Flag
  // angepasst werden – die Ticket-Logik darf nachtraeglich nicht mutieren.
  if (existing.redeemedAt) {
    const allowedAfterRedeem = new Set([
      "notes",
      "expiresAt",
      "disabled",
    ]);
    const submitted = Object.keys(data);
    const blocked = submitted.filter((k) => !allowedAfterRedeem.has(k));
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error: {
            formErrors: [
              `Eingelöste Gutscheine können nur an Notiz/Verfall geändert werden.`,
            ],
          },
        },
        { status: 400 },
      );
    }
  }

  // Service/AccessArea Existenz pruefen, wenn explizit gesetzt.
  if (data.serviceId != null) {
    const svc = await db.service.findFirst({
      where: { id: data.serviceId, ...(accountId ? { accountId } : {}) },
      select: { id: true },
    });
    if (!svc) {
      return NextResponse.json(
        { error: { formErrors: ["Service nicht gefunden."] } },
        { status: 400 },
      );
    }
  }
  if (data.accessAreaId != null) {
    const area = await db.accessArea.findFirst({
      where: { id: data.accessAreaId, ...(accountId ? { accountId } : {}) },
      select: { id: true },
    });
    if (!area) {
      return NextResponse.json(
        { error: { formErrors: ["Bereich nicht gefunden."] } },
        { status: 400 },
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (data.ticketTypeName !== undefined) updateData.ticketTypeName = data.ticketTypeName;
  if (data.serviceId !== undefined) updateData.serviceId = data.serviceId;
  if (data.accessAreaId !== undefined) updateData.accessAreaId = data.accessAreaId;
  if (data.validityType !== undefined) {
    updateData.validityType = VALIDITY_TYPES.includes(data.validityType as ValidityType)
      ? (data.validityType as ValidityType)
      : "DATE_RANGE";
  }
  if (data.validityDurationMinutes !== undefined) {
    updateData.validityDurationMinutes = data.validityDurationMinutes;
  }
  if (data.discountPercent !== undefined) updateData.discountPercent = data.discountPercent;
  if (data.expiresAt !== undefined) {
    updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  }
  if (data.notes !== undefined) {
    const trimmed = (data.notes ?? "").trim();
    updateData.notes = trimmed.length > 0 ? trimmed : null;
  }
  if (data.disabled !== undefined) {
    updateData.disabledAt = data.disabled ? new Date() : null;
  }

  const updated = await db.voucher.update({
    where: { id: voucherId },
    data: updateData,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // DELETE = Soft-Delete: Gutschein wird deaktiviert, aber nicht entfernt
  // (Audit-Trail bleibt erhalten, eingelöste Vouchers bleiben referenzierbar).
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const voucherId = Number(id);
  if (Number.isNaN(voucherId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.voucher.findFirst({
    where: { id: voucherId, ...(accountId ? { accountId } : {}) },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  await db.voucher.update({
    where: { id: voucherId },
    data: { disabledAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

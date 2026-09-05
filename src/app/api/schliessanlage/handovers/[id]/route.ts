import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { handoverInclude } from "@/lib/keying-queries";
import { prisma } from "@/lib/prisma";
import { keyHandoverUpdateSchema } from "@/lib/validators";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const handoverId = Number((await params).id);
  if (isNaN(handoverId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const handover = await db.keyHandover.findFirst({
    where: { id: handoverId, accountId: accountId! },
    include: handoverInclude,
  });
  if (!handover) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(handover);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const handoverId = Number((await params).id);
  if (isNaN(handoverId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keyHandoverUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.keyHandover.findFirst({ where: { id: handoverId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  if (data.policyTemplateId != null) {
    const template = await db.keyPolicyTemplate.findFirst({
      where: { id: data.policyTemplateId, accountId },
      select: { id: true },
    });
    if (!template) return NextResponse.json({ error: "Vorlage nicht gefunden" }, { status: 400 });
  }

  const handover = await db.keyHandover.update({
    where: { id: handoverId },
    data: {
      ...(data.policyTemplateId !== undefined && {
        policyTemplateId: data.policyTemplateId ?? null,
      }),
      ...(data.dueAt !== undefined && { dueAt: data.dueAt ? new Date(data.dueAt) : null }),
      ...(data.deposit !== undefined && { deposit: data.deposit ?? null }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
    include: handoverInclude,
  });
  return NextResponse.json(handover);
}

/**
 * Loeschen ist nur erlaubt, solange nichts unterschrieben wurde. Offene
 * Schluessel wandern dabei zurueck in den Bestand.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const handoverId = Number((await params).id);
  if (isNaN(handoverId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.keyHandover.findFirst({
    where: { id: handoverId, accountId },
    include: {
      items: { select: { keyId: true, itemStatus: true } },
      signatures: { where: { signedAt: { not: null } }, select: { id: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  if (existing.signatures.length > 0) {
    return NextResponse.json(
      { error: "Protokoll ist unterschrieben und kann nicht gelöscht werden" },
      { status: 409 },
    );
  }

  const openKeyIds = existing.items
    .filter((i) => i.itemStatus === "ISSUED")
    .map((i) => i.keyId);

  // Roher Client in einer Transaktion; alle Filter tragen den accountId.
  await prisma.$transaction(async (tx) => {
    if (openKeyIds.length > 0) {
      await tx.keyItem.updateMany({
        where: { id: { in: openKeyIds }, accountId },
        data: { status: "AVAILABLE" },
      });
    }
    await tx.keyHandover.delete({ where: { id: handoverId } });
  });

  return NextResponse.json({ ok: true });
}

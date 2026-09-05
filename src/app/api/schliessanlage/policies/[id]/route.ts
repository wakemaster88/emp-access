import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { keyPolicyUpdateSchema } from "@/lib/validators";

/**
 * Vorlagen sind append-only: eine Textaenderung erzeugt eine neue Version,
 * damit bereits signierte Dokumente reproduzierbar bleiben. Nur `isActive`
 * wird direkt am Datensatz umgeschaltet.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const policyId = Number((await params).id);
  if (isNaN(policyId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keyPolicyUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.keyPolicyTemplate.findFirst({ where: { id: policyId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  const name = data.name?.trim() ?? existing.name;
  const bodyText = data.bodyText?.trim() ?? existing.bodyText;
  const liabilityText =
    data.liabilityText !== undefined ? data.liabilityText?.trim() || null : existing.liabilityText;

  const textChanged =
    name !== existing.name ||
    bodyText !== existing.bodyText ||
    liabilityText !== existing.liabilityText;

  if (!textChanged) {
    if (data.isActive === undefined) return NextResponse.json(existing);

    const updated = await prisma.$transaction(async (tx) => {
      if (data.isActive) {
        await tx.keyPolicyTemplate.updateMany({
          where: { accountId, name: existing.name },
          data: { isActive: false },
        });
      }
      return tx.keyPolicyTemplate.update({
        where: { id: policyId },
        data: { isActive: data.isActive! },
      });
    });
    return NextResponse.json(updated);
  }

  const latest = await db.keyPolicyTemplate.findFirst({
    where: { accountId, name },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const isActive = data.isActive ?? true;

  // Roher Client in einer Transaktion; alle Filter tragen den accountId.
  const created = await prisma.$transaction(async (tx) => {
    if (isActive) {
      await tx.keyPolicyTemplate.updateMany({
        where: { accountId, name },
        data: { isActive: false },
      });
    }
    return tx.keyPolicyTemplate.create({
      data: {
        accountId,
        name,
        version: (latest?.version ?? 0) + 1,
        bodyText,
        liabilityText,
        isActive,
      },
    });
  });

  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const policyId = Number((await params).id);
  if (isNaN(policyId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.keyPolicyTemplate.findFirst({
    where: { id: policyId, accountId },
    include: { _count: { select: { signatures: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Bereits verwendete Versionen werden nur deaktiviert; der Volltext steckt
  // ohnehin als Snapshot in der Signatur, die Referenz bleibt aber nachvollziehbar.
  if (existing._count.signatures > 0) {
    const updated = await db.keyPolicyTemplate.update({
      where: { id: policyId },
      data: { isActive: false },
    });
    return NextResponse.json({ ok: true, deactivated: true, policy: updated });
  }

  await db.keyPolicyTemplate.delete({ where: { id: policyId } });
  return NextResponse.json({ ok: true, deactivated: false });
}

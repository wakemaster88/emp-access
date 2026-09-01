import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { createHolder } from "@/lib/key-holders";
import { findUnavailableKeys } from "@/lib/keying";
import { handoverInclude } from "@/lib/keying-queries";
import { prisma } from "@/lib/prisma";
import { keyHandoverCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const handovers = await db.keyHandover.findMany({
    where: { accountId: accountId! },
    include: handoverInclude,
    orderBy: { issuedAt: "desc" },
  });
  return NextResponse.json(handovers);
}

/** Schluesselausgabe: Protokoll anlegen und Schluessel als ausgegeben buchen. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyHandoverCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  let holderId = data.holderId ?? null;
  if (holderId != null) {
    const holder = await db.keyHolder.findFirst({ where: { id: holderId, accountId } });
    if (!holder) return NextResponse.json({ error: "Empfänger nicht gefunden" }, { status: 400 });
  } else if (data.newHolder) {
    const created = await createHolder(db, accountId, data.newHolder);
    if (!created.ok) return NextResponse.json({ error: created.message }, { status: 400 });
    holderId = created.holderId;
  }
  if (holderId == null) {
    return NextResponse.json({ error: "Empfänger erforderlich" }, { status: 400 });
  }

  if (data.policyTemplateId != null) {
    const template = await db.keyPolicyTemplate.findFirst({
      where: { id: data.policyTemplateId, accountId },
      select: { id: true },
    });
    if (!template) return NextResponse.json({ error: "Vorlage nicht gefunden" }, { status: 400 });
  }

  const keyIds = [...new Set(data.keyIds)];
  const keys = await db.keyItem.findMany({
    where: { id: { in: keyIds }, accountId },
    select: { id: true, keyNumber: true, status: true },
  });
  if (keys.length !== keyIds.length) {
    return NextResponse.json({ error: "Unbekannter Schlüssel ausgewählt" }, { status: 400 });
  }

  const blocked = findUnavailableKeys(keys);
  if (blocked.length > 0) {
    return NextResponse.json(
      { error: `Nicht verfügbar: ${blocked.map((k) => k.keyNumber).join(", ")}` },
      { status: 409 },
    );
  }

  // Raw `prisma.$transaction`, weil der tenantClient jede Query in eine eigene
  // Transaktion wrappt – RLS setzen wir hier als erstes Statement selbst.
  const handover = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId)}, TRUE)`;

    const created = await tx.keyHandover.create({
      data: {
        accountId,
        holderId,
        policyTemplateId: data.policyTemplateId ?? null,
        issuedByName: data.issuedByName?.trim() || session.session.user.name || null,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        deposit: data.deposit ?? null,
        notes: data.notes?.trim() || null,
        status: "ISSUED",
        items: { create: keyIds.map((keyId) => ({ keyId })) },
      },
      include: handoverInclude,
    });

    await tx.keyItem.updateMany({
      where: { id: { in: keyIds }, accountId },
      data: { status: "ISSUED" },
    });

    return created;
  });

  return NextResponse.json(handover, { status: 201 });
}

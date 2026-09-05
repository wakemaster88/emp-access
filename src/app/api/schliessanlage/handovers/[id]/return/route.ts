import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { deriveHandoverStatus, keyStatusAfterReturn } from "@/lib/keying";
import { handoverInclude } from "@/lib/keying-queries";
import { prisma } from "@/lib/prisma";
import { keyReturnSchema } from "@/lib/validators";

/** Rueckgabe einzelner oder aller offenen Schluessel eines Protokolls. */
export async function POST(
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

  const parsed = keyReturnSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const handover = await db.keyHandover.findFirst({
    where: { id: handoverId, accountId },
    include: { items: { select: { id: true, keyId: true, itemStatus: true } } },
  });
  if (!handover) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  const itemStatus = data.itemStatus ?? "RETURNED";
  const openItems = handover.items.filter((i) => i.itemStatus === "ISSUED");

  const targets = data.all
    ? openItems
    : openItems.filter((i) => data.itemIds!.includes(i.id));

  if (targets.length === 0) {
    return NextResponse.json({ error: "Keine offenen Schlüssel ausgewählt" }, { status: 400 });
  }

  const targetIds = targets.map((t) => t.id);
  const targetKeyIds = targets.map((t) => t.keyId);
  const returnedByName = data.returnedByName?.trim() || session.session.user.name || null;

  // Roher Client in einer Transaktion; die Positionen sind oben bereits als
  // Datensaetze dieses Accounts geprueft.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.keyHandoverItem.updateMany({
      where: { id: { in: targetIds } },
      data: {
        itemStatus,
        returnedAt: new Date(),
        returnedByName,
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
      },
    });

    await tx.keyItem.updateMany({
      where: { id: { in: targetKeyIds }, accountId },
      data: { status: keyStatusAfterReturn(itemStatus) },
    });

    const items = await tx.keyHandoverItem.findMany({
      where: { handoverId },
      select: { itemStatus: true },
    });

    return tx.keyHandover.update({
      where: { id: handoverId },
      data: { status: deriveHandoverStatus(items) },
      include: handoverInclude,
    });
  });

  return NextResponse.json(updated);
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lostItemUpdateSchema } from "@/lib/validators";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const itemId = Number(id);
  if (isNaN(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = lostItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const existing = await db.lostItem.findFirst({
    where: { id: itemId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const item = await db.lostItem.update({
    where: { id: itemId },
    data: {
      ...(data.description !== undefined && { description: data.description.trim() }),
      ...(data.foundDate !== undefined && { foundDate: new Date(data.foundDate) }),
      ...(data.image !== undefined && { image: data.image }),
      ...(data.contact !== undefined && { contact: data.contact?.trim() || null }),
      ...(data.pickedUp !== undefined && {
        pickedUp: data.pickedUp,
        pickedUpAt: data.pickedUp ? (existing.pickedUpAt ?? new Date()) : null,
      }),
    },
  });
  return NextResponse.json(item);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const itemId = Number(id);
  if (isNaN(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.lostItem.findFirst({
    where: { id: itemId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.lostItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}

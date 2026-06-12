import { NextRequest, NextResponse } from "next/server";
import { resolveLostItemAuth } from "@/lib/lost-item-auth";
import { buildLostItemUpdateData } from "@/lib/lost-item-data";
import { lostItemUpdateSchema } from "@/lib/validators";

/** GET /api/lost-items/[id] – einzelner Eintrag inkl. Bild. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveLostItemAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const itemId = Number(id);
  if (isNaN(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = auth;
  const item = await db.lostItem.findFirst({
    where: { id: itemId, accountId },
  });
  if (!item) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(item);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveLostItemAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const itemId = Number(id);
  if (isNaN(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = lostItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = auth;
  const existing = await db.lostItem.findFirst({
    where: { id: itemId, accountId },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const item = await db.lostItem.update({
    where: { id: itemId },
    data: buildLostItemUpdateData(parsed.data, existing),
  });
  return NextResponse.json(item);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveLostItemAuth(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const itemId = Number(id);
  if (isNaN(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = auth;
  const existing = await db.lostItem.findFirst({
    where: { id: itemId, accountId },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.lostItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}

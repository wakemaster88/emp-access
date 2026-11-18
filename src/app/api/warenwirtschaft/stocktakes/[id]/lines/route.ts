import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, stocktakeLinesSchema, wawiSession } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/warenwirtschaft/stocktakes/[id]/lines – Zählmengen speichern (nur offene Inventur). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = stocktakeLinesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const st = await s.db.stocktake.findFirst({ where: { id, accountId: s.accountId }, select: { status: true } });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist festgeschrieben" }, { status: 409 });
  for (const l of parsed.data.lines) {
    const data: { counted?: number | null; broken?: number | null } = {};
    if (l.counted !== undefined) data.counted = l.counted;
    if (l.broken !== undefined) data.broken = l.broken;
    await s.db.stocktakeLine.updateMany({ where: { id: l.id, stocktakeId: id, accountId: s.accountId }, data });
  }
  return NextResponse.json({ ok: true });
}

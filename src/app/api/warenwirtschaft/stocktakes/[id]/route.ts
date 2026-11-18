import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, wawiSession } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

/** PATCH /api/warenwirtschaft/stocktakes/[id] – Titel und Notiz (nur offene). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const res = await s.db.stocktake.updateMany({ where: { id, accountId: s.accountId, status: "OPEN" }, data: parsed.data });
  if (res.count === 0) return notFound("Offene Inventur");
  return NextResponse.json({ ok: true });
}

/** DELETE /api/warenwirtschaft/stocktakes/[id] – nur offene; festgeschriebene bleiben. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const res = await s.db.stocktake.deleteMany({ where: { id, accountId: s.accountId, status: "OPEN" } });
  if (res.count === 0) return notFound("Offene Inventur");
  return NextResponse.json({ ok: true });
}

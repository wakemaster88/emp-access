import { NextRequest, NextResponse } from "next/server";
import { assetSchema, badRequest, dateOnly, notFound, wawiSession } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/warenwirtschaft/assets/[id] – Stammdaten und (optional) Mengen je Jahr. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = assetSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const { counts, lastInspection, ...rest } = parsed.data;
  const res = await s.db.inventoryAsset.updateMany({
    where: { id, accountId: s.accountId },
    data: {
      ...rest,
      ...(lastInspection !== undefined && { lastInspection: lastInspection ? dateOnly(lastInspection) : null }),
    },
  });
  if (res.count === 0) return notFound("Inventar-Eintrag");
  for (const c of counts ?? []) {
    if (c.quantity == null) {
      await s.db.inventoryAssetCount.deleteMany({ where: { assetId: id, year: c.year, accountId: s.accountId } });
    } else {
      await s.db.inventoryAssetCount.upsert({
        where: { assetId_year: { assetId: id, year: c.year } },
        create: { accountId: s.accountId, assetId: id, year: c.year, quantity: c.quantity },
        update: { quantity: c.quantity },
      });
    }
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/warenwirtschaft/assets/[id] */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const res = await s.db.inventoryAsset.deleteMany({ where: { id, accountId: s.accountId } });
  if (res.count === 0) return notFound("Inventar-Eintrag");
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { assetCountSchema, badRequest, notFound, wawiSession } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/warenwirtschaft/assets/[id]/count – Menge eines Jahres setzen (null löscht sie). */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = assetCountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const asset = await s.db.inventoryAsset.findFirst({ where: { id, accountId: s.accountId }, select: { id: true } });
  if (!asset) return notFound("Inventar-Eintrag");
  const { year, quantity } = parsed.data;
  if (quantity == null) {
    await s.db.inventoryAssetCount.deleteMany({ where: { assetId: id, year, accountId: s.accountId } });
  } else {
    await s.db.inventoryAssetCount.upsert({
      where: { assetId_year: { assetId: id, year } },
      create: { accountId: s.accountId, assetId: id, year, quantity },
      update: { quantity },
    });
  }
  return NextResponse.json({ ok: true });
}

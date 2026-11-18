import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINK_GONE, loadInventoryLink } from "@/lib/inventory-count-link";
import { publicImageSchema } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ token: string }> };

/** POST /api/zaehlen/inventar/[token]/image – fehlendes Foto eines Postens (überschreibt keins). */
export async function POST(request: NextRequest, { params }: Ctx) {
  const l = await loadInventoryLink((await params).token);
  if (!l) return NextResponse.json({ error: LINK_GONE.NONE }, { status: 404 });
  if (l === "EXPIRED") return NextResponse.json({ error: LINK_GONE.EXPIRED }, { status: 410 });
  const parsed = publicImageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const res = await prisma.inventoryAsset.updateMany({
    where: { id: parsed.data.id, accountId: l.accountId, group: l.group, image: null },
    data: { image: parsed.data.image },
  });
  if (res.count === 0) return NextResponse.json({ error: "Dieser Posten hat schon ein Foto" }, { status: 409 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { assetSchema, badRequest, dateOnly, wawiSession } from "@/lib/warenwirtschaft-server";

/** POST /api/warenwirtschaft/assets – Inventar-Eintrag anlegen. */
export async function POST(request: NextRequest) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const parsed = assetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const { counts, lastInspection, ...rest } = parsed.data;
  const asset = await s.db.inventoryAsset.create({
    data: {
      ...rest,
      accountId: s.accountId,
      lastInspection: lastInspection ? dateOnly(lastInspection) : null,
      counts: {
        create: (counts ?? [])
          .filter((c) => c.quantity != null)
          .map((c) => ({ accountId: s.accountId, year: c.year, quantity: c.quantity! })),
      },
    },
    select: { id: true },
  });
  return NextResponse.json(asset, { status: 201 });
}

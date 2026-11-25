import { NextRequest, NextResponse } from "next/server";
import { defaultAssetYear } from "@/lib/warenwirtschaft";
import { badRequest, countTokenExpiry, inventoryLinkSchema, newCountToken, wawiSession } from "@/lib/warenwirtschaft-server";

/**
 * Zähl-Link fürs Handy je Inventar-Blatt.
 *   POST   {group, year?} – Link erzeugen oder erneuern (der alte wird ungültig)
 *   DELETE ?group=…       – Link sperren
 */
export async function POST(request: NextRequest) {
  const s = await wawiSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const parsed = inventoryLinkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const { group } = parsed.data;
  const year = parsed.data.year ?? defaultAssetYear();
  const data = { token: newCountToken(), expiresAt: countTokenExpiry(), year };
  await s.db.inventoryCountLink.upsert({
    where: { accountId_group: { accountId: s.accountId, group } },
    create: { accountId: s.accountId, group, ...data },
    update: data,
  });
  return NextResponse.json({ token: data.token, expiresAt: data.expiresAt.toISOString(), year });
}

export async function DELETE(request: NextRequest) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const group = request.nextUrl.searchParams.get("group");
  if (!group) return badRequest("group fehlt");
  await s.db.inventoryCountLink.deleteMany({ where: { accountId: s.accountId, group } });
  return NextResponse.json({ ok: true });
}
